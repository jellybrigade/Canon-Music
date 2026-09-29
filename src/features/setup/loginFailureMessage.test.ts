import { describe, expect, it } from "vitest";
import { SubsonicError } from "../../clients/navidromeTransport";
import { loginFailureMessage } from "./loginFailureMessage";

describe("loginFailureMessage", () => {
  it("names a wrong password for code 40", () => {
    const message = loginFailureMessage(new SubsonicError("ping.view", 40, "Wrong username or password"), "password");

    expect(message).toBe("Wrong username or password. Check both and try again.");
  });

  it("names the api key for code 40 on an api-key login", () => {
    const message = loginFailureMessage(new SubsonicError("ping.view", 40, "Wrong username or password"), "apikey");

    expect(message).toBe("The server did not accept this username and API key.");
  });

  it("names the api key for code 44", () => {
    const message = loginFailureMessage(new SubsonicError("ping.view", 44, "Invalid API key"), "apikey");

    expect(message).toBe("The server did not accept this username and API key.");
  });

  it("passes other server errors through", () => {
    const message = loginFailureMessage(new SubsonicError("ping.view", 30, "Incompatible client"), "password");

    expect(message).toBe("Incompatible client");
  });

  it("passes transport errors through", () => {
    expect(loginFailureMessage(new Error("Server returned 404."), "password")).toBe("Server returned 404.");
    expect(loginFailureMessage("boom", "password")).toBe("boom");
  });
});
