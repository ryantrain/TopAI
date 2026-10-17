# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are investors and people exploring fintech or the stock market who want a concrete way to follow current AI and market-performance trends. They use the dashboard to observe how autonomous traders evaluate competing AI workers, inspect the reasoning behind trades, and understand the resulting market performance.

## Product Purpose

Agent Exchange is a hackathon project and local autonomous AI stock exchange. It turns benchmark performance by competing AI worker agents into a virtual market where autonomous traders place orders, positions settle, and the outcome can be inspected. Success means making an emerging fintech-style market mechanism understandable and credible enough for an investor-curious audience to explore.

## Positioning

Gemini-powered autonomous traders invest in competing AI models using benchmark-driven market data, then analyze the resulting market performance. TigerData or SQLite preserves the market record, and an optional Phantom-signed Solana Devnet receipt can verifiably publish a settled round.

## Operating Context

The product runs locally as a Next.js dashboard with a FastAPI backend. A user starts a demo or live round, observes benchmark, trading, reveal, and settlement phases, then inspects worker answers, trader theses, orders, prices, performance history, and archived rounds. Live mode uses configured AI providers and the GSM8K test split; demo mode uses explicitly labeled simulated data.

## Capabilities and Constraints

- Five autonomous traders buy virtual shares in three AI worker agents from benchmark performance.
- Trades and credits settle in the Python application; the system does not execute an on-chain exchange or transfer real assets.
- Solana is limited to optional Devnet receipts for settled rounds, signed by the user through Phantom and independently verified against the recorded round.
- TigerData/PostgreSQL or SQLite stores active and archived market snapshots. No authentication or multi-user public deployment is implemented.
- The interface must clearly distinguish demo simulation from live API mode, and must not imply actual financial trading, real funds, trustless settlement, or measured model superiority that the evidence cannot support.
- Open question: the requested description says trades “execute on Solana,” while the implemented scope records only settled-round receipts on Solana. Any future public claim needs the intended wording clarified.

## Brand Commitments

Use the product name **Agent Exchange**. Preserve a credible, transparent fintech-research voice: autonomous agents and AI-market mechanics should be legible without overstating realism or financial claims.

## Evidence on Hand

- The repository contains a working local dashboard, FastAPI market API, tests, and a demo mode.
- Live mode can use OpenAI, Gemini, and optionally Anthropic workers; Gemini powers the existing trading and analyst roles.
- The implementation includes local archive storage, optional TigerData/PostgreSQL storage, and an optional Solana Devnet receipt flow.
- No validated investor outcomes, customer testimonials, production trading results, or real financial-market claims are available. Future work must not fabricate them.

## Product Principles

1. Make the market mechanism inspectable: show the data, orders, and settlement behind a result.
2. Distinguish simulation, live model execution, and on-chain publication precisely.
3. Help fintech-curious users understand trends through concrete agent performance rather than opaque claims.
4. Preserve a clear audit trail for every completed round.
5. Keep the experience exploratory and educational, never a representation of real investment advice or real-asset trading.

## Accessibility & Inclusion

The dashboard supports keyboard interaction for its dialogs and honors reduced-motion preferences. Future interface work should preserve these behaviors and maintain clear labeling for technical and finance-adjacent concepts.
