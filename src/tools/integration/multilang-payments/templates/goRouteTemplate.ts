import { SnippetResponse } from '../../common/snippetTypes.js';

const notes = "Gin handler that re-posts incoming payloads to Payram's /api/v1/payment endpoint.";

export const buildGoPaymentHandlerSnippet = (): SnippetResponse => ({
  title: 'Gin route for Payram create-payment API',
  snippet: `package payments

import (
    "bytes"
    "encoding/json"
    "net/http"
    "os"
    "strings"

    "github.com/gin-gonic/gin"
)

const payramPaymentPath = "/api/v1/payment"

type CreatePaymentPayload struct {
    CustomerEmail string  \`json:"customerEmail" binding:"required,email"\`
    CustomerID    string  \`json:"customerID" binding:"required"\`
    AmountInUSD   float64 \`json:"amountInUSD" binding:"required"\`
}

func RegisterPayramPaymentRoutes(router *gin.Engine) {
    router.POST("/api/pay/create", func(c *gin.Context) {
        var payload CreatePaymentPayload
        if err := c.ShouldBindJSON(&payload); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "details": err.Error()})
            return
        }

        baseURL := os.Getenv("PAYRAM_BASE_URL")
        apiKey := os.Getenv("PAYRAM_API_KEY")

        if baseURL == "" || apiKey == "" {
            c.JSON(http.StatusInternalServerError, gin.H{"error": "payram_not_configured"})
            return
        }

        normalized := strings.TrimRight(baseURL, "/")
        body, _ := json.Marshal(payload)

        req, err := http.NewRequest(http.MethodPost, normalized+payramPaymentPath, bytes.NewBuffer(body))
        if err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": "request_build_failed"})
            return
        }

        req.Header.Set("Content-Type", "application/json")
        req.Header.Set("API-Key", apiKey)

        resp, err := http.DefaultClient.Do(req)
        if err != nil {
            c.JSON(http.StatusBadGateway, gin.H{"error": "payram_upstream_error", "details": err.Error()})
            return
        }
        defer resp.Body.Close()

        var payramBody map[string]any
        if err := json.NewDecoder(resp.Body).Decode(&payramBody); err != nil {
            c.JSON(http.StatusBadGateway, gin.H{"error": "invalid_payram_response"})
            return
        }

        if resp.StatusCode >= 400 {
            c.JSON(resp.StatusCode, gin.H{"error": "payram_error", "details": payramBody})
            return
        }

        c.JSON(http.StatusOK, payramBody)
    })
}
`,
  meta: {
    language: 'go',
    framework: 'gin',
    filenameSuggestion: 'internal/payments/payram_payment_handler.go',
    description: "Gin helper that forwards /api/pay/create to Payram's /api/v1/payment API.",
  },
  notes,
});
