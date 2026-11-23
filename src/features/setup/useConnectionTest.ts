import { useRef, useState } from "react";
import { authenticate, authenticateWithApiKey } from "../../clients/navidrome";
import type { NavidromeCredential } from "../../clients/navidromeUrls";
import { loginFailureMessage } from "./loginFailureMessage";

export type AuthMethod = "password" | "apikey";
export type TestState = "idle" | "testing" | "ok" | "error";

export interface ConnectionFields {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  authMethod: AuthMethod;
}

export type AlternateResult = { url: string } & (
  | { state: "testing" }
  | { state: "ok" }
  | { state: "error"; error: string }
);

function login(fields: ConnectionFields, url: string): Promise<NavidromeCredential> {
  return fields.authMethod === "apikey"
    ? authenticateWithApiKey(url, fields.username, fields.apiKey)
    : authenticate(url, fields.username, fields.password);
}

function sameFields(a: ConnectionFields, b: ConnectionFields): boolean {
  return (
    a.url === b.url &&
    a.username === b.username &&
    a.authMethod === b.authMethod &&
    (a.authMethod === "apikey" ? a.apiKey === b.apiKey : a.password === b.password)
  );
}

// Only the primary gates saving: the alternate is often a LAN address that can't
// answer from where the test runs, so its result is reported beside it (D-1).
export function useConnectionTest() {
  const [state, setState] = useState<TestState>("idle");
  const [error, setError] = useState("");
  const [tested, setTested] = useState<{ fields: ConnectionFields; credential: NavidromeCredential } | null>(null);
  const [alternate, setAlternate] = useState<AlternateResult | null>(null);
  // A run whose fields were edited mid-flight must not land its verdict on the new ones.
  const generation = useRef(0);

  function reset() {
    generation.current++;
    setState("idle");
    setTested(null);
    setAlternate(null);
  }

  // Each address lands on its own: a LAN alternate that can't answer runs the whole retry
  // ladder, and the primary's verdict must not wait for it.
  function run(fields: ConnectionFields, altUrl: string): Promise<void> {
    const runGeneration = ++generation.current;
    const isCurrent = () => runGeneration === generation.current;
    const alternateUrl = altUrl.trim();
    setState("testing");
    setError("");
    setAlternate(alternateUrl ? { url: alternateUrl, state: "testing" } : null);
    const primary = login(fields, fields.url).then(
      (credential) => {
        if (!isCurrent()) return;
        setState("ok");
        setTested({ fields, credential });
      },
      (err: unknown) => {
        if (!isCurrent()) return;
        setState("error");
        setError(loginFailureMessage(err, fields.authMethod));
      },
    );
    const alternateCheck = alternateUrl
      ? login(fields, alternateUrl).then(
          () => {
            if (isCurrent()) setAlternate({ url: alternateUrl, state: "ok" });
          },
          (err: unknown) => {
            if (isCurrent()) {
              setAlternate({ url: alternateUrl, state: "error", error: loginFailureMessage(err, fields.authMethod) });
            }
          },
        )
      : null;
    return Promise.all([primary, alternateCheck]).then(() => undefined);
  }

  return {
    state,
    error,
    run,
    reset,
    isTested: (fields: ConnectionFields) => tested !== null && sameFields(tested.fields, fields),
    testedCredential: tested?.credential ?? null,
    alternateFor: (altUrl: string) => (alternate !== null && alternate.url === altUrl.trim() ? alternate : null),
  };
}
