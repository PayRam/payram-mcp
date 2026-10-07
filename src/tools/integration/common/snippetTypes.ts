export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'php' | 'java';

export type SupportedBackendFramework =
  'nextjs' | 'express' | 'fastapi' | 'gin' | 'laravel' | 'spring-boot' | 'generic-http';

export interface SnippetMeta {
  language: SupportedLanguage;
  framework: SupportedBackendFramework;
  filenameSuggestion?: string;
  description?: string;
}

export interface SnippetResponse {
  title: string;
  snippet: string;
  meta: SnippetMeta;
  notes?: string;
}
