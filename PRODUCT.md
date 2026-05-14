# Product

## Register

product

## Users

The primary users are active retail or institutional market watchers who need a calm, reliable way to monitor tracked financial assets, review alert history, and configure price movement notifications. They use the product during recurring market checks and while responding to threshold events, often scanning dense numerical data rather than reading long-form content.

Secondary users include system operators or product stakeholders validating the alerting pipeline: Top 100 synchronization, price aggregation, SNS and SQS routing, notification delivery, and alert history persistence.

## Product Purpose

This product is a serverless financial monitoring platform. It gives authenticated users a market dashboard, asset detail views, historical alert review, watchlist controls, and notification settings backed by AWS API Gateway, Lambda, RDS, SNS, SQS, SES, Cognito, S3, and CloudFront.

Success means users can quickly answer three questions: what changed, whether it matters, and what action or configuration change is needed. The interface should make price movement, priority status, watch state, and notification preferences legible without creating the urgency or clutter of a trading terminal.

## Brand Personality

Quiet, institutional, precise.

The product should feel like a trustworthy financial operations tool shaped by Coinbase-inspired restraint: white canvas, cool neutrals, scarce blue action color, strong numerical legibility, and direct language. It should communicate confidence and control without hype, gamification, or speculative energy.

## Anti-references

Avoid crypto-casino aesthetics, neon dashboards, dark-by-default trading terminals, excessive gradients, decorative volatility graphics, meme-coin energy, and over-saturated red or green fills. Avoid generic SaaS card grids, hero metric layouts, and marketing-first surfaces inside the authenticated product.

Avoid interfaces that make standard actions feel novel for novelty's sake: unconventional toggles, odd table behavior, custom scrollbars, decorative modals, and animation that delays task completion.

## Design Principles

1. Lead with scanability: asset rows, alert logs, thresholds, and notification states should be easy to compare at a glance.
2. Separate urgency from noise: high-priority alerts need clear hierarchy, while standard market movement should remain calm and readable.
3. Keep action color scarce: blue is for primary actions, selected states, focus, and key brand moments, not decoration.
4. Treat numbers as product content: prices, percentage changes, market cap, ranks, and thresholds need tabular alignment, stable widths, and consistent semantic color.
5. Make backend state understandable: users should see when data was updated, whether alerts are read, which assets are watched, and whether notification settings are active.

## Accessibility & Inclusion

Target WCAG 2.2 AA for contrast, keyboard access, focus visibility, form labeling, and responsive layout. Do not rely on red and green alone for market direction or priority. Pair semantic color with labels, icons, signs, or text. Support reduced motion by limiting animation to fast state feedback and disabling nonessential transitions when requested.

Tables, filters, toggles, and settings forms should work with keyboard and screen readers. Price updates should avoid disruptive live-region noise; reserve announcements for meaningful alert events, errors, and saved settings.
