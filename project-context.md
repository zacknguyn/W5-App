# Project Context: Serverless Vietnamese Financial Pipeline

## 1. System Overview
100% Serverless financial data platform for the Vietnamese market (HOSE/HNX/UPCOM) using `vnstock`.

*   **Architecture**: Event-driven AWS Lambda stack.
*   **Persistence**: RDS (Structured/UI) + EFS (Bulk/History).
*   **Messaging**: SNS Topic -> Filter Policies -> Tiered SQS (Priority vs. Standard).

## 2. Core Lambda Flows

### A. `Market_Updater` (The Ingestor)
*   **Trigger**: EventBridge (Every 5 mins during VN Market Hours).
*   **Action**: 
    1.  Fetch live prices via `vnstock.price_board()`.
    2.  **Write to RDS**: Update `Assets` table for real-time UI.
    3.  **Append to EFS**: Log 5-min snapshot to `/mnt/efs/history/today.csv`.

### B. `Anomaly_Logging_Service` (The Scanner)
*   **Trigger**: EventBridge (Periodic or End-of-Day).
*   **Action**: 
    1.  **Pull from EFS**: Reads bulk historical CSV for analysis.
    2.  **Logic**: Detects price threshold breaks (3%-5%).
    3.  **Routing**: Uses a **hardcoded VN30 list** to set SNS metadata attributes.
    4.  **Publish**: Sends alert JSON to SNS.

### C. `Data_Aggregation_Worker` (The Consumer)
*   **Trigger**: SQS (Priority or Standard).
*   **Action**: 
    1.  Consumes JSON alert from queue.
    2.  Sends Notification (SES Email / SNS SMS).
    3.  **Write to RDS**: Logs event to `Alert_History` table for UI retrieval.

### D. `Asset_Reader` (The Provider)
*   **Trigger**: User via API Gateway.
*   **Action**: Serves JSON to Vue.js frontend by reading from RDS `Assets` and `Alert_History`.

## 3. Data Strategy (RDS vs EFS)
*   **RDS (PostgreSQL/MySQL)**: 
    *   *Role*: Application Brain.
    *   *Data*: Live prices, User watchlists, Alert logs, Auth.
    *   *Goal*: Fast, relational, indexed UI lookups.
*   **EFS (Elastic File System)**: 
    *   *Role*: Data Lake.
    *   *Data*: Bulk 5-minute snapshots (CSVs), ML models, large report exports.
    *   *Goal*: Shared high-volume storage between Lambdas; bypasses Lambda `/tmp` and RDS Blob limits.

## 4. Market Context
*   **Library**: `vnstock` 4.0.
*   **Market**: HOSE, HNX, UPCOM (VND currency).
*   **Key Hours**: 9:00 AM - 11:30 AM, 1:00 PM - 3:00 PM ICT.
