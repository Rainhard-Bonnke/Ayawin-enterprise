# Safaricom Daraja Specification Notes

Retrieved: 2026-11-07

## Official sources reviewed

- Daraja developer portal: https://developer.safaricom.co.ke/
- Getting Started: https://developer.safaricom.co.ke/apis/GettingStarted
- Authorization: https://developer.safaricom.co.ke/apis/Authorization
- M-Pesa Express (STK Push): https://developer.safaricom.co.ke/apis/MpesaExpressSimulate
- M-Pesa Express Query: https://developer.safaricom.co.ke/apis/MpesaExpressQuery
- Customer to Business (C2B): https://developer.safaricom.co.ke/apis/CustomerToBusiness
- Business to Customer (B2C): https://developer.safaricom.co.ke/apis/BusinessToCustomer
- Transaction Status: https://developer.safaricom.co.ke/apis/TransactionStatus

## Verified API facts

- Safaricom's Daraja Getting Started page lists callback source addresses `196.201.214.200`, `196.201.214.206`, `196.201.213.114`, `196.201.214.207`, `196.201.214.208`, `196.201.213.44`, `196.201.212.127`, `196.201.212.138`, `196.201.212.129`, `196.201.212.136`, `196.201.212.74`, and `196.201.212.69`. Verified from https://developer.safaricom.co.ke/apis/GettingStarted on 2026-11-09. Configure them as `/32` entries only after re-verifying; the application default remains allowlist-off.
- Safaricom's Transaction Status documentation, fetched 2026-11-09, confirms the query request is acknowledged first and the final result is asynchronous. The result callback carries `Result.OriginatorConversationID`, `ResultCode`, `ResultType`, `ResultDesc`, `TransactionID`, and `ResultParameters`; `ResultType=1` means waiting for further messages. Do not treat query-request HTTP acceptance or a non-final result callback as payment confirmation.

- OAuth uses GET `https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials` with Basic authentication. The documented access-token lifetime is one hour (`expires_in` around 3599 seconds).
- STK Push uses POST `/mpesa/stkpush/v1/processrequest`. The documented request has `BusinessShortCode`, base64 `Password` formed from shortcode + passkey + timestamp, `Timestamp`, `TransactionType`, `Amount`, `PartyA`, `PartyB`, `PhoneNumber`, `CallBackURL`, `AccountReference`, and `TransactionDesc`. Receipt callbacks use `Body.stkCallback`, `MerchantRequestID`, `CheckoutRequestID`, and `ResultCode`; success metadata includes amount, receipt number, transaction date and phone number.
- STK Query uses POST `/mpesa/stkpushquery/v1/query` with shortcode, password, timestamp and `CheckoutRequestID`. Its response includes `ResponseCode`, `ResultCode`, and `ResultDesc`; a `ResultCode` of 0 denotes successful processing and 1032 denotes user cancellation in the cited documentation.
- C2B URL registration uses POST `/mpesa/c2b/v2/registerurl` with `ShortCode`, `ResponseType`, `ConfirmationURL`, and `ValidationURL`. External validation is optional and must be enabled for the shortcode. Confirmation callbacks contain `TransID`, `TransTime`, `TransAmount`, `BusinessShortCode`, `BillRefNumber`, and customer data; the V2 documentation describes the MSISDN as masked. The documentation says C2B amounts are whole numbers.
- B2C uses POST `/mpesa/b2c/v3/paymentrequest`, is asynchronous, and returns a later result callback. `OriginatorConversationID` is the merchant-generated unique request ID; results include `ResultCode`, `TransactionID`, and result parameters. Production requires an approved B2C/disbursement account or an enabled one-account setup. The Daraja FAQ says B2C reversals are not supported through the API.
- Transaction Status is an asynchronous query for C2B/B2B/B2C and other transactions. Its request can identify the transaction by M-Pesa receipt number (`TransactionID`) or `OriginalConversationID`; results return asynchronously to the configured callback.
- The Getting Started page lists Safaricom callback source IPs (retrieved on this date) and says Daraja callbacks are asynchronous. Configure allowlisting rather than hard-coding the list as permanent; verify with Safaricom before production because published ranges may change.
- The Daraja documentation describes security credentials for B2C/Transaction Status as an RSA encryption of the initiator password using the environment's Safaricom certificate with PKCS #1.5 padding and base64 output. The STK passkey/password construction is a separate mechanism.
- Production onboarding requires a live shortcode, active API product, operator/initiator roles and go-live approvals; sandbox credentials are not production credentials.

## Implementation constraints and uncertainties

- No provider request, callback, or test should contain real credentials or make real network calls. Tests must use deterministic mocks and recorded non-secret fixtures.
- STK callback confirmation is independently checked through the documented asynchronous Transaction Status API before posting a receipt. The initial query acknowledgement is not treated as a final payment status; the callback is matched by its originator conversation ID.
- C2B V2 masks the incoming MSISDN, so this path cannot be treated as a full-phone source. Store only the available masked value and never infer missing digits.
- Whole-shilling C2B amounts are explicitly documented. The STK page gives a numeric amount but does not state fractional KES support. Do not silently round invoice balances with cents; reject/request a deliberate rounding policy until Safaricom confirms accepted STK amount precision.
- Daraja documents C2B URL callbacks and statuses, but its public pages reviewed here do not specify cryptographic callback signatures. The application must enforce the requested unguessable company callback path token, schema validation, HTTPS in production, rate limiting, idempotency, and an independent provider status query before accounting posting.
- The published callback IP list is recorded in the source page but should be treated as configurable, optional defense-in-depth and revalidated before production.
