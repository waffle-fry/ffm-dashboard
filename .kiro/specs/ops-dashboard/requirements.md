# Requirements Document

## Introduction

FansFund is an anonymous payment platform connecting Creators and their fans. The ops-dashboard is an operational dashboard for the small FansFund team, designed to run on a 25" monitor connected to a Mac Mini in a local Kubernetes cluster. The dashboard consolidates key business metrics from MongoDB, Grafana, Stripe, AWS S3, and Mercury (the platform's business bank) into a single, visually branded interface. It provides real-time visibility into revenue, user growth, system health, dispute management, and the platform's own cash balances so the team can operate proactively.

## Glossary

- **Dashboard**: The web-based operational interface displaying widgets with real-time metrics
- **Widget**: A discrete, configurable UI component that displays a specific metric or group of related metrics
- **Layout**: The arrangement of widgets on the dashboard grid
- **Dispute**: A Stripe payment dispute (chargeback) that requires evidence submission within a deadline
- **Dispute_Batch**: A numbered folder in S3 containing dispute evidence documents, located at s3://fans-fund-me-core-dispute-docs/batches/<number>/<payment-id>
- **Creator**: A user on FansFund who receives anonymous payments from fans
- **Fan**: A user on FansFund who sends anonymous payments to Creators
- **Evidence_Upload**: The process of uploading dispute documents to S3
- **Evidence_Submission**: The process of submitting uploaded evidence to Stripe to respond to a dispute
- **System_Health**: The operational status of FansFund services as reported by Grafana
- **Dashboard_Engine**: The server-side component that aggregates data from MongoDB, Stripe, Grafana, and AWS S3
- **Dashboard_UI**: The client-side component that renders widgets and handles user interaction
- **Mercury**: The platform's business banking provider, whose account balance is retrieved via the Mercury API
- **Platform_Balance**: The platform's own cash holdings — its Stripe available balance plus its Mercury bank balance, expressed in USD

## Requirements

### Requirement 1: Dashboard Layout and Branding

**User Story:** As an ops team member, I want the dashboard to follow the FansFund brand guidelines on a large display, so that the dashboard looks professional and is easy to read at a glance.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL render with a dark background (minimum contrast ratio of 4.5:1 between background and body text), light text, Work Sans (sans-serif) as the body font at a minimum size of 14px, Outfit (sans-serif) as the heading font at a minimum size of 18px, and yellow/gold as the accent color applied only to highlights, emphasis elements, and alert indicators.
2. THE Dashboard_UI SHALL render without horizontal scrollbar and without content overflow or text truncation at any viewport width from 1024px to 5120px, redistributing widget columns to maintain readability across that range.
3. THE Dashboard_UI SHALL render all widgets in a grid-based layout that fills the available viewport at a resolution of 1920x1080 on a 25" monitor without requiring vertical or horizontal scrolling when displaying the default widget configuration as defined in Requirement 2, criterion 3.
4. IF the Work Sans or Outfit fonts fail to load within 3 seconds, THEN THE Dashboard_UI SHALL render text using the system default sans-serif font without blocking page display.

### Requirement 2: Widget Configuration

**User Story:** As an ops team member, I want to configure which widgets are displayed and how they are arranged, so that I can customize the dashboard to show the most relevant information for the team.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL allow the user to add, remove, reorder, and resize widgets within the grid layout, where each widget has a minimum size of 1 grid column by 1 grid row and a maximum size equal to the full grid dimensions.
2. THE Dashboard_UI SHALL persist widget configuration (widget selection, order, position, and size) in browser local storage so that the configuration is retained across browser sessions.
3. IF no saved widget configuration exists in browser local storage, THEN THE Dashboard_UI SHALL load a default configuration that includes all available metric widgets arranged in the grid layout.
4. WHEN a widget is added or moved, THE Dashboard_UI SHALL update the layout within 500 milliseconds without a full page reload.
5. IF a saved configuration references a widget type that is no longer available, THEN THE Dashboard_UI SHALL remove the unavailable widget from the layout and display the remaining configured widgets.

### Requirement 3: Revenue and Payment Metrics

**User Story:** As an ops team member, I want to see payment and revenue metrics from Stripe, so that I can monitor business performance in real time.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL retrieve revenue data from the Stripe API and present total gross revenue, net revenue, and total fees for the current day (midnight UTC to now), current week (Monday 00:00 UTC to now), and current month (1st 00:00 UTC to now), displaying all monetary values in GBP with two decimal places.
2. THE Dashboard_Engine SHALL retrieve the count of successful payments, failed payments, and refunds for the current day, current week, and current month from Stripe using the same UTC-based time boundaries.
3. THE Dashboard_Engine SHALL calculate and display the average payment amount (total gross revenue divided by total successful payment count) for the current day, current week, and current month, displaying "N/A" when no successful payments exist in the period.
4. WHEN new payment activity occurs in Stripe, THE Dashboard_Engine SHALL reflect the updated metrics within 5 minutes.

### Requirement 4: User and Creator Growth Metrics

**User Story:** As an ops team member, I want to see user and creator growth metrics from MongoDB, so that I can track platform adoption and engagement.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL query MongoDB and display the total number of registered Creators and total number of registered Fans.
2. THE Dashboard_Engine SHALL display the number of new Creators and new Fans registered in the current day (midnight UTC to now), current week (Monday 00:00 UTC to now), and current month (1st 00:00 UTC to now).
3. THE Dashboard_Engine SHALL display the number of active Creators (Creators who received at least one successful payment) in the current day, current week, and current month using the same UTC-based time boundaries.
4. WHEN user registration data changes in MongoDB, THE Dashboard_Engine SHALL reflect the updated counts within 5 minutes.
5. IF no registrations or active creators exist for a given time period, THEN THE Dashboard_Engine SHALL display zero rather than omitting the metric.

### Requirement 5: System Health Metrics

**User Story:** As an ops team member, I want to see system health and uptime information from Grafana, so that I can detect issues before they affect users.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL retrieve service health status from the Grafana API and display the current status (healthy, degraded, or down) for each monitored service.
2. THE Dashboard_Engine SHALL display the uptime percentage, rounded to two decimal places, for each monitored service over the last 24 hours and the last 7 days.
3. THE Dashboard_Engine SHALL display the error rate (errors per minute) averaged over the last 5 minutes and the average response latency (in milliseconds) over the last 5 minutes for the platform API.
4. WHEN a Grafana alert is firing, THE Dashboard_UI SHALL highlight the affected service widget using the yellow/gold accent color.
5. WHEN Grafana reports a service status change, THE Dashboard_Engine SHALL reflect the change within 60 seconds.
6. IF the Grafana API is unreachable or returns an error, THEN THE Dashboard_UI SHALL display a visual indicator on the health metrics section stating that data is unavailable, and SHALL retain the last successfully retrieved values until a successful response is received.
7. IF metric data for a monitored service has not been updated for more than 120 seconds, THEN THE Dashboard_UI SHALL display a stale-data indicator on the affected service widget.

### Requirement 6: Dispute Deadline Tracking

**User Story:** As an ops team member, I want to see how many days remain until the next dispute evidence deadline, so that I can prioritize dispute work and avoid missing deadlines.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL retrieve all open disputes from the Stripe API and calculate the number of calendar days remaining until each dispute's evidence_due_by timestamp, using UTC for all date comparisons.
2. THE Dashboard_UI SHALL display the number of days until the nearest dispute deadline prominently as a countdown with a minimum font size of 32px.
3. THE Dashboard_UI SHALL display a list of all open disputes ordered by deadline (soonest first), showing the payment ID, dispute amount in GBP with two decimal places, and days remaining for each.
4. IF a dispute deadline is 3 or fewer calendar days away, THEN THE Dashboard_UI SHALL display the countdown in yellow/gold accent color to indicate urgency.
5. IF a dispute deadline is 1 or fewer calendar days away, THEN THE Dashboard_UI SHALL display the countdown in red to indicate critical urgency.
6. IF no open disputes exist, THEN THE Dashboard_UI SHALL display "No open disputes" in the countdown area.
7. IF a dispute deadline has already passed (days remaining is negative), THEN THE Dashboard_UI SHALL display "OVERDUE" in red with the number of days past the deadline.
8. IF the Stripe API is unreachable, THEN THE Dashboard_UI SHALL display the last known dispute data with a stale-data indicator showing the time since the last successful refresh.
9. THE Dashboard_UI SHALL display the total number of open disputes on the Dispute Deadlines widget alongside the deadline list.

### Requirement 7: Dispute Process Progress Tracking

**User Story:** As an ops team member, I want to see which part of the dispute process is outstanding for each open dispute, so that I can identify bottlenecks and coordinate work between team members.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL check AWS S3 at the path s3://fans-fund-me-core-dispute-docs/batches/<number>/<payment-id> to determine whether evidence documents have been uploaded for each open dispute, where the batch number is the most recent batch folder containing a subfolder matching the dispute's payment ID.
2. WHEN at least one file of size greater than zero bytes exists in the S3 path for a dispute, THE Dashboard_Engine SHALL mark the Evidence_Upload step as complete.
3. WHEN no files exist or all files are zero bytes in the S3 path for a dispute, THE Dashboard_Engine SHALL mark the Evidence_Upload step as outstanding.
4. IF evidence documents exist in S3 for a dispute AND the dispute status in Stripe is "needs_response", THEN THE Dashboard_Engine SHALL mark the Evidence_Submission step as outstanding.
5. IF the dispute status in Stripe is "under_review" or "won" or "lost", THEN THE Dashboard_Engine SHALL mark both the Evidence_Upload and Evidence_Submission steps as complete.
6. THE Dashboard_UI SHALL display each open dispute with a two-step progress indicator labeled "Evidence Upload" and "Evidence Submission", showing each step as either "Complete" or "Outstanding".
7. THE Dashboard_Engine SHALL treat a dispute as open when its Stripe status is "warning_needs_response" or "needs_response" (the statuses still requiring a response from the team), and SHALL exclude disputes whose evidence has already been submitted or which are resolved — statuses "warning_under_review", "under_review", "won", "lost", and "charge_refunded" — from the open disputes list.

### Requirement 8: Data Refresh and Connectivity

**User Story:** As an ops team member, I want the dashboard to refresh data automatically and notify me of connectivity issues, so that I can trust the information displayed is current.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL refresh all widget data automatically at a configurable interval with a default of 5 minutes and a configurable range from 1 minute to 60 minutes.
2. THE Dashboard_UI SHALL display a timestamp indicating when each widget's data was last refreshed.
3. IF a data source (MongoDB, Stripe, Grafana, or AWS S3) does not respond within 10 seconds, THEN THE Dashboard_UI SHALL display an error indicator on the affected widgets and show the time of the last successful data retrieval, clearing the error indicator on the next successful refresh.
4. THE Dashboard_UI SHALL allow the user to manually trigger a data refresh for all widgets or for an individual widget, ignoring duplicate refresh requests while a refresh is already in progress.
5. WHILE a data refresh is in progress, THE Dashboard_UI SHALL display a visual loading indicator on the affected widgets.

### Requirement 9: Recent Transactions Feed

**User Story:** As an ops team member, I want to see a live feed of recent transactions, so that I can verify the platform is processing payments and spot anomalies quickly.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL retrieve the 20 most recent successful payments from Stripe including the amount displayed in the transaction's original currency with two decimal places, the timestamp displayed in ISO 8601 format with timezone, and a truncated transaction identifier showing only the last 4 characters of the Stripe payment ID prefixed with "…".
2. THE Dashboard_UI SHALL display the recent transactions in a scrollable list ordered by most recent first, showing all available transactions when fewer than 20 exist.
3. WHEN a new payment is processed, THE Dashboard_Engine SHALL include the payment in the feed within 5 minutes of occurrence.
4. THE Dashboard_UI SHALL NOT display any personally identifiable information (fan names, creator names, email addresses, full payment IDs, or billing addresses) in the transaction feed.
5. IF the Stripe API is unavailable or returns an error, THEN THE Dashboard_Engine SHALL display the most recently cached transaction data and present an indicator showing the time since the last successful data refresh.

### Requirement 10: Platform Summary Metrics

**User Story:** As an ops team member, I want to see high-level platform summary numbers at a glance, so that I can quickly understand overall platform status.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL calculate and display the gross volume processed through the platform from Stripe for the current month (1st 00:00 UTC to now), displayed in GBP with two decimal places.
2. THE Dashboard_Engine SHALL calculate and display the platform's take rate (platform fees divided by gross volume, expressed as a percentage rounded to two decimal places) for the current month, displaying "N/A" when gross volume is zero.
3. THE Dashboard_Engine SHALL display the dispute rate (number of disputes divided by total payments, expressed as a percentage rounded to two decimal places) for the current month, displaying "0.00%" when no payments exist.
4. THE Dashboard_Engine SHALL display the total number of payments processed in the current month (1st 00:00 UTC to now).

### Requirement 11: Platform Account Balances

**User Story:** As an ops team member, I want to see the platform's own cash balances — its Stripe balance, its Mercury bank balance, and the combined total — on the Platform Summary widget, so that I can understand how much money the platform is holding across its accounts at a glance.

#### Acceptance Criteria

1. THE Dashboard_Engine SHALL retrieve the platform's own Stripe account balance via the Stripe Balance API (the platform account itself, not any connected account), sum the available balance across all currency entries, convert it to USD, and present the result in USD with two decimal places.
2. THE Dashboard_Engine SHALL retrieve the platform's Mercury bank account balance via the Mercury API and present the total available balance across the platform's Mercury accounts in USD with two decimal places.
3. THE Dashboard_Engine SHALL convert any non-USD amount to USD using the exchange rates stored in the `ExchangeRates` collection of the `Payments` MongoDB database, and SHALL treat a USD amount as its own USD-equivalent without conversion.
4. THE Dashboard_Engine SHALL calculate the total platform balance as the sum, in USD, of the USD Stripe available balance and the USD Mercury available balance, and SHALL display it in USD with two decimal places.
5. THE Dashboard_Engine SHALL also present the total platform balance converted to GBP using the `ExchangeRates` collection, displayed in GBP with two decimal places.
6. THE Dashboard_UI SHALL display four distinct stat tiles on the Platform Summary widget — Stripe balance (USD), Mercury balance (USD), total balance (USD), and total balance (GBP) — with each USD figure prefixed by the business currency symbol and the GBP total prefixed by the pound symbol.
7. IF the platform Stripe balance cannot be retrieved (for example, the API key lacks the `balance` read permission), THEN THE Dashboard_UI SHALL display a non-fatal error indicator on the Stripe balance tile while continuing to display the Mercury balance and the remaining summary metrics.
8. IF the Mercury balance cannot be retrieved (for example, the Mercury API token is missing or the request fails), THEN THE Dashboard_UI SHALL display a non-fatal error indicator on the Mercury balance tile while continuing to display the Stripe balance and the remaining summary metrics.
9. IF only one of the two account balances is available, THEN THE Dashboard_Engine SHALL calculate the total balance from the available source alone, and IF neither balance is available THEN THE Dashboard_UI SHALL display the total tiles as unavailable rather than as zero.
10. IF a required exchange rate for converting an amount to USD or to GBP is unavailable, THEN THE Dashboard_Engine SHALL treat the affected figure as unavailable (excluding it from the USD total where applicable), and THE Dashboard_UI SHALL surface a non-fatal error indicator on the affected tile.
