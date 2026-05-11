import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

// Mock the error reporter module
vi.mock("../lib/errorReporter", () => ({
  reportError: vi.fn(),
}));

import { reportError } from "../lib/errorReporter";

const mockedReportError = vi.mocked(reportError);

// A component that throws on render
function ThrowingComponent({ error }: { error: Error }) {
  throw error;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    mockedReportError.mockClear();
    // Suppress React's console.error for expected errors in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls reportError when a child component throws", () => {
    const testError = new Error("Test crash");

    render(
      <ErrorBoundary>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );

    expect(mockedReportError).toHaveBeenCalledTimes(1);
    expect(mockedReportError).toHaveBeenCalledWith(testError, expect.any(String));
  });

  it("passes the component stack to reportError", () => {
    const testError = new Error("Stack test");

    render(
      <ErrorBoundary>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );

    const [, componentStack] = mockedReportError.mock.calls[0];
    expect(typeof componentStack).toBe("string");
    expect(componentStack).toContain("ThrowingComponent");
  });

  it("renders fallback UI after catching an error", () => {
    const testError = new Error("Render fallback");

    const { getByText } = render(
      <ErrorBoundary>
        <ThrowingComponent error={testError} />
      </ErrorBoundary>
    );

    expect(getByText("Something went wrong")).toBeInTheDocument();
  });
});
