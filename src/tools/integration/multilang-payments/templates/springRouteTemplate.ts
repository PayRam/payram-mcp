import { SnippetResponse } from '../../common/snippetTypes.js';

const notes = "Spring WebFlux WebClient example that posts to Payram's /api/v1/payment endpoint.";

export const buildSpringPaymentControllerSnippet = (): SnippetResponse => ({
  title: 'Spring Boot controller for Payram create-payment API',
  snippet: `package com.example.payments;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

@RestController
@RequestMapping("/api/pay")
public class PayramPaymentController {

    private final WebClient webClient;
    private final String payramBaseUrl;
    private final String payramApiKey;

    public PayramPaymentController(
            WebClient.Builder webClientBuilder,
            @Value("\${PAYRAM_BASE_URL:}") String payramBaseUrl,
            @Value("\${PAYRAM_API_KEY:}") String payramApiKey) {
        this.webClient = webClientBuilder.build();
        this.payramBaseUrl = payramBaseUrl;
        this.payramApiKey = payramApiKey;
    }

    @PostMapping("/create")
    public ResponseEntity<?> createPayment(@RequestBody CreatePaymentRequest request) {
        if (payramBaseUrl == null || payramBaseUrl.isBlank() || payramApiKey == null || payramApiKey.isBlank()) {
            return ResponseEntity.status(500).body(Map.of("error", "payram_not_configured"));
        }

        String normalizedBase = payramBaseUrl.endsWith("/")
                ? payramBaseUrl.substring(0, payramBaseUrl.length() - 1)
                : payramBaseUrl;
        String endpoint = normalizedBase + "/api/v1/payment";

        try {
            Map<String, Object> payload = webClient.post()
                    .uri(endpoint)
                    .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .header("API-Key", payramApiKey)
                    .bodyValue(request)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            return ResponseEntity.ok(payload);
        } catch (WebClientResponseException ex) {
            return ResponseEntity.status(ex.getStatusCode())
                    .body(Map.of("error", "payram_error", "details", ex.getResponseBodyAsString()));
        } catch (Exception ex) {
            return ResponseEntity.status(502)
                    .body(Map.of("error", "payram_upstream_error", "details", ex.getMessage()));
        }
    }
}

class CreatePaymentRequest {
    private String customerEmail;
    private String customerID;
    private Double amountInUSD;

    public String getCustomerEmail() {
        return customerEmail;
    }

    public void setCustomerEmail(String customerEmail) {
        this.customerEmail = customerEmail;
    }

    public String getCustomerID() {
        return customerID;
    }

    public void setCustomerID(String customerID) {
        this.customerID = customerID;
    }

    public Double getAmountInUSD() {
        return amountInUSD;
    }

    public void setAmountInUSD(Double amountInUSD) {
        this.amountInUSD = amountInUSD;
    }
}
`,
  meta: {
    language: 'java',
    framework: 'spring-boot',
    filenameSuggestion: 'src/main/java/com/example/payments/PayramPaymentController.java',
    description:
      "Spring Boot REST controller that proxies /api/pay/create to Payram's create-payment endpoint.",
  },
  notes,
});
