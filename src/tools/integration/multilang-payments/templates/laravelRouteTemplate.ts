import { SnippetResponse } from '../../common/snippetTypes.js';

const notes =
  'Laravel example built from the documented /api/v1/payment request and response fields.';

export const buildLaravelPaymentRouteSnippet = (): SnippetResponse => ({
  title: 'Laravel controller for Payram create-payment API',
  snippet: `use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::post('/api/pay/create', [PayramPaymentController::class, 'create']);

class PayramPaymentController extends Controller
{
    public function create(Request $request)
    {
        $payload = $request->validate([
            'customerEmail' => ['required', 'email'],
            'customerID' => ['required', 'string'],
            'amountInUSD' => ['required', 'numeric', 'min:0.01'],
        ]);

        $baseUrl = rtrim(env('PAYRAM_BASE_URL', ''), '/');
        $apiKey = env('PAYRAM_API_KEY');

        if (!$baseUrl || !$apiKey) {
            return response()->json(['error' => 'payram_not_configured'], 500);
        }

        $payramResponse = Http::withHeaders([
            'API-Key' => $apiKey,
            'Content-Type' => 'application/json',
        ])->post($baseUrl . '/api/v1/payment', [
            'customerEmail' => $payload['customerEmail'],
            'customerID' => $payload['customerID'],
            'amountInUSD' => $payload['amountInUSD'],
        ]);

        if ($payramResponse->failed()) {
            return response()->json([
                'error' => 'payram_error',
                'details' => $payramResponse->json(),
            ], $payramResponse->status());
        }

        return response()->json($payramResponse->json());
    }
}
`,
  meta: {
    language: 'php',
    framework: 'laravel',
    filenameSuggestion: 'app/Http/Controllers/PayramPaymentController.php',
    description:
      "Laravel controller+route that proxies /api/pay/create to Payram's /api/v1/payment API.",
  },
  notes,
});
