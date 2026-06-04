/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "../page";
import PredictiveFailureAnalysisPanel from "../components/PredictiveFailureAnalysisPanel";

const prediction = {
  riskScore: 86,
  riskLevel: "critical" as const,
  confidence: "low" as const,
  summary: "Highly likely to fail unless adjusted.",
  evidence: {
    gasShortfall: true,
    intervalTooFast: true,
    contractReputation: "Unknown contract profile.",
  },
};

describe("Predictive Failure Analysis UI", () => {
  it("renders the risk badge and evidence summary for a critical prediction", () => {
    render(<PredictiveFailureAnalysisPanel status="success" prediction={prediction} />);

    expect(screen.getByText(/execution failure risk/i)).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
    expect(screen.getByText(/gas shortfall/i)).toBeInTheDocument();
    expect(screen.getByText(/too frequent/i)).toBeInTheDocument();
  });

  it("shows a predictive panel when filling the task creation form", async () => {
    render(<Home />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/target contract address/i), "CABC123");
    await user.type(screen.getByLabelText(/function name/i), "harvest_yield");
    await user.type(screen.getByLabelText(/interval/i), "60");
    await user.type(screen.getByLabelText(/gas balance/i), "1");

    await waitFor(
      () => expect(screen.queryByText(/execution failure risk/i)).toBeInTheDocument(),
      { timeout: 1200 }
    );

    await waitFor(() =>
      expect(
        screen.queryByText(/analyzing task configuration/i) || screen.queryByText(/likely to fail/i)
      ).toBeTruthy()
    );
  });
});
