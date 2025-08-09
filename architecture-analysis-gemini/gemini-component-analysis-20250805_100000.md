# Tryp Transit Component Analysis

**Date:** 2025-08-05

## 1. Frontend

The frontend is a Next.js application located in the `tryp_transit_0.2/src` directory.

### Key Technologies

*   **Next.js:** A React framework for building server-side rendered and static web applications.
*   **React:** A JavaScript library for building user interfaces.
*   **TypeScript:** A typed superset of JavaScript that compiles to plain JavaScript.
*   **Tailwind CSS:** A utility-first CSS framework for rapidly building custom designs.
*   **Prisma:** A modern database toolkit that makes it easy to work with databases.

### Key Features

*   **Trip Planning:** Users can plan their trips by providing departure and destination bus stops, and a desired arrival time.
*   **Transit Insights:** The application displays transit insights, including travel time, traffic density, cost savings, and personalized recommendations.
*   **Demo Mode:** The application includes a demo mode that allows users to try out the service with pre-configured scenarios.
*   **Rewards Program:** The application includes a rewards program to incentivize users to use public transit.

## 2. Backend API

The backend API is built with Next.js API routes and is located in the `tryp_transit_0.2/src/app/api` directory.

### Key Endpoints

*   `/api/transit-insights`: The main endpoint for fetching transit insights. It takes departure and destination coordinates, and a desired arrival time as input, and returns a JSON object with transit insights.
*   `/api/transit-insights-demo`: A demo version of the `transit-insights` endpoint.
*   `/api/rewards`: An endpoint for managing the rewards program.
*   `/api/getTravelTime`: An endpoint for getting the travel time between two points.

## 3. Model Service

The Model Service is a Python-based Flask application located in the `tryp_transit_0.2/model_service` directory.

### Key Technologies

*   **Flask:** A lightweight web framework for Python.
*   **Chronos:** A pre-trained time-series forecasting model from Amazon.
*   **Pandas:** A library for data manipulation and analysis.
*   **PyTorch:** An open-source machine learning library.

### Key Endpoints

*   `/predict/hourly/<int:hours_future>`: Predicts the hourly bus ridership for a given number of hours in the future.
*   `/predict/daily/<int:days_future>`: Predicts the daily bus ridership for a given number of days in the future.
