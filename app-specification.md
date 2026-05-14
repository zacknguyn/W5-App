# Specification: Serverless Financial Platform

## 1. Frontend Requirements (Vue.js / Vite)

### Core Views
*   **Market Dashboard**:
    *   List of all tracked assets with real-time price updates (pulled every 30s-60s).
    *   Visual indicators for Top 100 status (e.g., a "Priority" badge).
    *   Price change sparklines (daily trend).
*   **Alert Center**:
    *   A log of historical alerts (retrieved from `Alert_History` table).
    *   Filters for "High Priority" vs. "Standard" alerts.
    *   Unread/Read status for notifications.
*   **Asset Detail Page**:
    *   Detailed fundamentals (PE Ratio, Market Cap) from RDS.
    *   Toggle switch to "Watch" or "Unwatch" an asset.
*   **Settings / Alerts Config**:
    *   Form to set custom price thresholds (e.g., "Alert me if BTC moves 5%").
    *   Notification preferences (Email toggle, SMS toggle).

### Technical Features
*   **State Management**: Pinia or Vuex to store the asset list and alert history.
*   **API Integration**: Axios/Fetch calls to the AWS API Gateway.
*   **Authentication**: AWS Cognito integration for user login/signup.
*   **Static Hosting**: Build assets deployed to **S3** behind **CloudFront**.

---

## 2. Backend Requirements (AWS Serverless)

### Lambda Functions (The "4-Lambda" Core)
1.  **`Morning_Updater`**: Scheduled daily sync of the Top 100 tickers to RDS.
2.  **`Data_Aggregation_Worker`**: Scheduled 5-min price fetch, RDS sync, and SNS routing.
3.  **`Notification_Worker`**: SQS-triggered logic to send SES emails and log to `Alert_History`.
4.  **`UI_Provider_API`**: Multi-route Lambda (or separate Lambdas) to handle GET/POST/PATCH requests from the frontend.

### API Gateway Endpoints
*   `GET /assets`: Returns all current prices and fundamentals.
*   `GET /alerts`: Returns paginated alert history.
*   `POST /watchlist`: Adds a ticker to the user's tracking list.
*   `PATCH /settings`: Updates user-specific price thresholds.

### Database Schema (RDS / PostgreSQL)
*   **`assets`**: `ticker (PK), title, price, change_percent, market_cap, last_updated`.
*   **`top_100`**: `ticker (PK), rank, updated_at`.
*   **`users`**: `user_id (PK), email, alert_threshold_percent`.
*   **`user_watchlist`**: `user_id, ticker`.
*   **`alert_history`**: `alert_id (PK), ticker, price_at_event, message, priority_level, created_at`.

### Messaging Infrastructure
*   **SNS Topic**: `Market_Events` for broadcasting threshold breaks.
*   **SQS Queue 1**: `Priority_Alerts` (SNS Filter: `priority == true`).
*   **SQS Queue 2**: `Standard_Alerts` (SNS Filter: `priority == false`).

### Infrastructure Extras
*   **RDS Proxy**: For managing DB connection pooling from Lambdas.
*   **Secrets Manager**: To store the Alpha Vantage API Key securely.
*   **IAM Roles**: Least-privilege permissions for Lambdas to read/write to RDS and SNS.
