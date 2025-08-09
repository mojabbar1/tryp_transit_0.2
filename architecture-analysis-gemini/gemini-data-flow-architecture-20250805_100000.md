# Tryp Transit Data Flow Architecture

**Date:** 2025-08-05

## 1. Overview

This document describes the data flow within the Tryp Transit system. The data flow can be broken down into the following steps:

1.  The user interacts with the frontend to plan a trip.
2.  The frontend sends a request to the backend API.
3.  The backend API fetches data from external APIs and the Model Service.
4.  The backend API uses a generative AI model to generate transit insights.
5.  The backend API returns the transit insights to the frontend.
6.  The frontend displays the transit insights to the user.

## 2. Detailed Data Flow

The following diagram illustrates the detailed data flow within the system:

```
[User]
  |
  1. Enters trip details (departure, destination, arrival time)
  |
  v
[Frontend (Next.js)]
  |
  2. Sends POST request to /api/transit-insights with trip details
  |
  v
[Backend API (Next.js API Routes)]
  |
  3. Receives request and extracts trip details
  |
  +------------------------------------------------+
  |                                                |
  v                                                v
[TomTom API]                                     [Model Service (Flask)]
  |                                                |
  4. Fetches traffic flow and incident data        5. Fetches predicted hourly ridership
  |                                                |
  v                                                v
[Backend API]                                    [Backend API]
  |                                                |
  6. Receives traffic data                         7. Receives ridership prediction
  |                                                |
  +------------------------------------------------+
  |
  v
[Generative AI (OpenAI/Gemini)]
  |
  8. Constructs prompt with traffic data, route info, and ridership prediction
  |
  v
[Backend API]
  |
  9. Receives JSON response with transit insights
  |
  v
[Frontend (Next.js)]
  |
  10. Receives transit insights and displays them to the user
  |
  v
[User]
```
