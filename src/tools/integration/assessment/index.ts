import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { logger } from '../../../utils/logger.js';
import { safeHandler } from '../../common/errors.js';
import { buildToolSchemas } from '../../common/schemas.js';

const textContent = (text: string) => ({ type: 'text' as const, text });
const toStructuredContent = <T extends object>(value: T) => value as T & Record<string, unknown>;

type Confidence = 'high' | 'medium' | 'low';

type FrameworkName = 'express' | 'nextjs' | 'fastapi' | 'laravel' | 'gin' | 'spring-boot';

const REQUIRED_ENV_KEYS = ['PAYRAM_BASE_URL', 'PAYRAM_API_KEY'] as const;

const frameworkToolMap: Record<FrameworkName, string[]> = {
  express: ['snippet_express_payment_route', 'generate_payment_route_snippet'],
  nextjs: ['snippet_nextjs_payment_route', 'generate_payment_route_snippet'],
  fastapi: ['snippet_fastapi_payment_route', 'generate_payment_http_snippet'],
  laravel: ['snippet_laravel_payment_route'],
  gin: ['snippet_go_payment_handler'],
  'spring-boot': ['snippet_spring_payment_controller'],
};

const frameworkLanguageMap: Record<FrameworkName, string> = {
  express: 'node',
  nextjs: 'node',
  fastapi: 'python',
  laravel: 'php',
  gin: 'go',
  'spring-boot': 'java',
};

const assessmentResponseSchema = z.object({
  summary: z.string(),
  detectedFiles: z.array(z.string()).optional(),
  packageManagers: z.array(
    z.object({
      type: z.string(),
      path: z.string(),
    }),
  ),
  frameworks: z.array(
    z.object({
      name: z.string(),
      language: z.string(),
      confidence: z.enum(['high', 'medium', 'low'] as const),
      evidence: z.array(z.string()),
      recommendedTools: z.array(z.string()).optional(),
    }),
  ),
  envStatus: z.object({
    fileFound: z.boolean(),
    envPath: z.string().optional(),
    variables: z.array(
      z.object({
        key: z.string(),
        present: z.boolean(),
        placeholder: z.boolean().optional(),
        valuePreview: z.string().optional(),
      }),
    ),
    notes: z.string().optional(),
  }),
  payramDependencies: z.array(
    z.object({
      packageName: z.string(),
      version: z.string().optional(),
      source: z.string(),
    }),
  ),
  recommendedNextSteps: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string(),
      tool: z.string().optional(),
    }),
  ),
});

const schemas = buildToolSchemas({
  input: z.object({}).strict(),
  output: assessmentResponseSchema,
});

interface FrameworkFinding {
  name: FrameworkName;
  confidence: Confidence;
  evidence: string[];
}

interface PackageManagerFinding {
  type: string;
  path: string;
}

interface PayramDependencyFinding {
  packageName: string;
  version?: string;
  source: string;
}

const fileExists = async (filePath: string) =>
  fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);

const readFileIfExists = async (filePath: string) => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const detectFrameworksFromPackageJson = (
  pkg: Record<string, any>,
): { frameworks: FrameworkFinding[]; payramDeps: PayramDependencyFinding[] } => {
  const frameworks: FrameworkFinding[] = [];
  const payramDeps: PayramDependencyFinding[] = [];
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<
    string,
    string
  >;

  const addFramework = (name: FrameworkName, confidence: Confidence, evidence: string) => {
    frameworks.push({ name, confidence, evidence: [evidence] });
  };

  if (deps.payram) {
    payramDeps.push({ packageName: 'payram', version: deps.payram, source: 'package.json' });
  }

  if (deps.express) {
    addFramework('express', 'high', 'package.json lists express dependency');
  }

  if (deps.next || deps['nextjs']) {
    addFramework('nextjs', 'high', 'package.json lists next dependency');
  }

  return { frameworks, payramDeps };
};

const detectFrameworksFromRequirements = (
  contents: string,
  source: string,
): { frameworks: FrameworkFinding[]; payramDeps: PayramDependencyFinding[] } => {
  const frameworks: FrameworkFinding[] = [];
  const payramDeps: PayramDependencyFinding[] = [];
  const lower = contents.toLowerCase();

  const has = (needle: string) => lower.includes(needle.toLowerCase());

  if (has('payram')) {
    payramDeps.push({ packageName: 'payram', source });
  }

  if (has('fastapi')) {
    frameworks.push({
      name: 'fastapi',
      confidence: 'medium',
      evidence: [`${source} references fastapi`],
    });
  }

  return { frameworks, payramDeps };
};

const detectFrameworksFromComposer = (
  composer: Record<string, any>,
): { frameworks: FrameworkFinding[]; payramDeps: PayramDependencyFinding[] } => {
  const frameworks: FrameworkFinding[] = [];
  const payramDeps: PayramDependencyFinding[] = [];
  const require = composer.require ?? {};

  if (require.payram) {
    payramDeps.push({ packageName: 'payram', version: require.payram, source: 'composer.json' });
  }

  if (require.laravel ?? require['laravel/framework']) {
    frameworks.push({
      name: 'laravel',
      confidence: 'high',
      evidence: ['composer.json lists laravel dependency'],
    });
  }

  return { frameworks, payramDeps };
};

const detectFrameworksFromGoMod = (contents: string): FrameworkFinding[] => {
  const frameworks: FrameworkFinding[] = [];
  if (/github.com\/(gin-gonic|gin-gonic\/gin)/i.test(contents)) {
    frameworks.push({
      name: 'gin',
      confidence: 'medium',
      evidence: ['go.mod references gin-gonic/gin'],
    });
  }
  return frameworks;
};

const detectFrameworksFromPom = (contents: string): FrameworkFinding[] => {
  const frameworks: FrameworkFinding[] = [];
  if (/spring-boot/i.test(contents)) {
    frameworks.push({
      name: 'spring-boot',
      confidence: 'medium',
      evidence: ['pom.xml references spring-boot'],
    });
  }
  return frameworks;
};

interface EnvVariableStatus {
  key: string;
  present: boolean;
  placeholder?: boolean;
  valuePreview?: string;
}

const summarizeEnv = async (
  root: string,
): Promise<{ status: z.infer<typeof assessmentResponseSchema.shape.envStatus> }> => {
  const envPath = path.join(root, '.env');
  const exists = await fileExists(envPath);
  if (!exists) {
    return {
      status: {
        fileFound: false,
        variables: REQUIRED_ENV_KEYS.map((key) => ({ key, present: false })),
        notes: 'No .env file detected in the workspace root.',
      },
    };
  }

  const contents = await readFileIfExists(envPath);
  const variables: EnvVariableStatus[] = REQUIRED_ENV_KEYS.map((key) => {
    if (!contents) {
      return { key, present: false };
    }
    const match = contents.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (!match) {
      return { key, present: false };
    }
    const rawValue = match[1].trim();
    const placeholder = /example|replace|your\b|todo/i.test(rawValue) || rawValue.length === 0;
    const preview =
      rawValue.length > 8 ? `${rawValue.slice(0, 4)}...${rawValue.slice(-2)}` : rawValue;
    return {
      key,
      present: true,
      placeholder,
      valuePreview: rawValue ? preview : undefined,
    };
  });

  return {
    status: {
      fileFound: true,
      envPath,
      variables,
      notes: variables.some((v) => v.placeholder)
        ? 'One or more variables look like placeholders. Replace them with real values before testing.'
        : undefined,
    },
  };
};

const buildRecommendations = (
  frameworks: FrameworkFinding[],
  envStatus: z.infer<typeof assessmentResponseSchema.shape.envStatus>,
  payramDeps: PayramDependencyFinding[],
): Array<z.infer<typeof assessmentResponseSchema.shape.recommendedNextSteps.element>> => {
  const steps: Array<z.infer<typeof assessmentResponseSchema.shape.recommendedNextSteps.element>> =
    [];

  if (!envStatus.fileFound || envStatus.variables.some((v) => !v.present)) {
    steps.push({
      id: 'env-missing',
      label: '.env missing required keys',
      detail: 'Run generate_env_template and fill PAYRAM_BASE_URL and PAYRAM_API_KEY.',
      tool: 'generate_env_template',
    });
  } else if (envStatus.variables.some((v) => v.placeholder)) {
    steps.push({
      id: 'env-placeholder',
      label: 'Replace placeholder credentials',
      detail:
        'Update PAYRAM_BASE_URL and PAYRAM_API_KEY with real values, then run test_payram_connection.',
      tool: 'test_payram_connection',
    });
  }

  if (payramDeps.length === 0) {
    steps.push({
      id: 'sdk-missing',
      label: 'Install Payram SDK / client dependencies',
      detail: 'Add the official Payram package for your language (e.g., npm install payram).',
    });
  }

  frameworks.forEach((framework, index) => {
    const mappedTools = frameworkToolMap[framework.name];
    if (mappedTools && mappedTools.length > 0) {
      steps.push({
        id: `framework-${framework.name}-${index}`,
        label: `Wire Payram routes into ${framework.name}`,
        detail: `Use ${mappedTools.join(', ')} to scaffold the route and adapt it inside your existing project.`,
        tool: mappedTools[0],
      });
    }
  });

  if (steps.length === 0) {
    steps.push({
      id: 'clarify-stack',
      label: 'Clarify stack details',
      detail:
        'Tell me which framework/language this project uses so I can suggest the right snippets.',
    });
  }

  return steps;
};

const summarizeFindings = (
  frameworks: FrameworkFinding[],
  envStatus: z.infer<typeof assessmentResponseSchema.shape.envStatus>,
): string => {
  const frameworkSummary =
    frameworks.length > 0
      ? `Detected ${frameworks.map((f) => f.name).join(', ')} based on dependency files.`
      : 'No supported framework detected automatically.';
  const envSummary = envStatus.fileFound
    ? envStatus.variables.every((v) => v.present && !v.placeholder)
      ? '.env has both PAYRAM variables.'
      : '.env found but variables are missing or look like placeholders.'
    : 'No .env file found.';
  return `${frameworkSummary} ${envSummary}`.trim();
};

export const registerProjectAssessmentTool = (server: McpServer) => {
  logger.debug('Registering Payram project assessment tool');

  server.registerTool(
    'assess_payram_project',
    {
      title: 'Assess Payram readiness in an existing codebase',
      description:
        'Inspects dependency files, frameworks, and .env status to suggest the next integration actions.',
      inputSchema: schemas.input,
      outputSchema: schemas.output,
    },
    safeHandler(
      async () => {
        const root = process.cwd();
        const detectedFiles: string[] = [];
        const packageManagers: PackageManagerFinding[] = [];
        const frameworks: FrameworkFinding[] = [];
        const payramDeps: PayramDependencyFinding[] = [];

        const pkgPath = path.join(root, 'package.json');
        if (await fileExists(pkgPath)) {
          detectedFiles.push('package.json');
          packageManagers.push({ type: 'node (npm/yarn/pnpm)', path: pkgPath });
          const pkg = await readJsonFile<Record<string, any>>(pkgPath);
          if (pkg) {
            const { frameworks: pkgFrameworks, payramDeps: pkgDeps } =
              detectFrameworksFromPackageJson(pkg);
            frameworks.push(...pkgFrameworks);
            payramDeps.push(...pkgDeps);
          }
        }

        const requirementsPath = path.join(root, 'requirements.txt');
        if (await fileExists(requirementsPath)) {
          detectedFiles.push('requirements.txt');
          packageManagers.push({ type: 'python (pip)', path: requirementsPath });
          const contents = await readFileIfExists(requirementsPath);
          if (contents) {
            const { frameworks: reqFrameworks, payramDeps: reqDeps } =
              detectFrameworksFromRequirements(contents, 'requirements.txt');
            frameworks.push(...reqFrameworks);
            payramDeps.push(...reqDeps);
          }
        }

        const pyprojectPath = path.join(root, 'pyproject.toml');
        if (await fileExists(pyprojectPath)) {
          detectedFiles.push('pyproject.toml');
          packageManagers.push({ type: 'python (poetry/pdm)', path: pyprojectPath });
          const contents = await readFileIfExists(pyprojectPath);
          if (contents) {
            const { frameworks: pyFrameworks, payramDeps: pyDeps } =
              detectFrameworksFromRequirements(contents, 'pyproject.toml');
            frameworks.push(...pyFrameworks);
            payramDeps.push(...pyDeps);
          }
        }

        const composerPath = path.join(root, 'composer.json');
        if (await fileExists(composerPath)) {
          detectedFiles.push('composer.json');
          packageManagers.push({ type: 'php (composer)', path: composerPath });
          const composerJson = await readJsonFile<Record<string, any>>(composerPath);
          if (composerJson) {
            const { frameworks: composerFrameworks, payramDeps: composerDeps } =
              detectFrameworksFromComposer(composerJson);
            frameworks.push(...composerFrameworks);
            payramDeps.push(...composerDeps);
          }
        }

        const goModPath = path.join(root, 'go.mod');
        if (await fileExists(goModPath)) {
          detectedFiles.push('go.mod');
          packageManagers.push({ type: 'go modules', path: goModPath });
          const contents = await readFileIfExists(goModPath);
          if (contents) {
            frameworks.push(...detectFrameworksFromGoMod(contents));
          }
        }

        const pomPath = path.join(root, 'pom.xml');
        if (await fileExists(pomPath)) {
          detectedFiles.push('pom.xml');
          packageManagers.push({ type: 'java (maven)', path: pomPath });
          const contents = await readFileIfExists(pomPath);
          if (contents) {
            frameworks.push(...detectFrameworksFromPom(contents));
          }
        }

        const gradlePath = path.join(root, 'build.gradle');
        if (await fileExists(gradlePath)) {
          detectedFiles.push('build.gradle');
          packageManagers.push({ type: 'java (gradle)', path: gradlePath });
          const contents = await readFileIfExists(gradlePath);
          if (contents && /spring-boot/i.test(contents)) {
            frameworks.push({
              name: 'spring-boot',
              confidence: 'medium',
              evidence: ['build.gradle references spring-boot'],
            });
          }
        }

        // Deduplicate frameworks by name + evidence.
        const uniqueFrameworks = frameworks.reduce<FrameworkFinding[]>((acc, curr) => {
          const existing = acc.find((item) => item.name === curr.name);
          if (existing) {
            existing.evidence.push(...curr.evidence);
            existing.confidence = existing.confidence === 'high' ? 'high' : curr.confidence;
          } else {
            acc.push({ ...curr });
          }
          return acc;
        }, []);

        const envResult = await summarizeEnv(root);
        const recommendations = buildRecommendations(
          uniqueFrameworks,
          envResult.status,
          payramDeps,
        );
        const summary = summarizeFindings(uniqueFrameworks, envResult.status);

        const frameworksForResponse = uniqueFrameworks.map((finding) => ({
          name: finding.name,
          language: frameworkLanguageMap[finding.name],
          confidence: finding.confidence,
          evidence: finding.evidence,
          recommendedTools: frameworkToolMap[finding.name],
        }));

        return {
          content: [textContent('Payram project assessment completed.'), textContent(summary)],
          structuredContent: toStructuredContent({
            summary,
            detectedFiles: detectedFiles.length ? detectedFiles : undefined,
            packageManagers,
            frameworks: frameworksForResponse,
            envStatus: envResult.status,
            payramDependencies: payramDeps,
            recommendedNextSteps: recommendations,
          }),
        };
      },
      { toolName: 'assess_payram_project' },
    ),
  );
};
