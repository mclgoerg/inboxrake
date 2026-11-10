// @vitest-environment jsdom
/* Sign-in page: the password form (label, show / hide, errors as an alert tied
 * to the field), the coded refusals worded from the locales, the SSO button
 * and its ?login_error= codes, the "how to reset" link. The real api.ts runs;
 * only fetch is stubbed. */

import { cleanup, fireEvent, render, screen, waitFor }
  from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLang } from "./i18n";
import { Login } from "./components/Login";

const logins: string[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { ok: true } };

beforeEach(() => {
  logins.length = 0;
  reply = { status: 200, body: { ok: true } };
  setLang("en");
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    logins.push(JSON.parse(String(init?.body)).password);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLang("en");
});

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("Password"), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

test("password mode: card with title, server name and a labelled field", () => {
  render(<Login mode="password" onLogin={() => {}} />);
  expect(screen.getByRole("heading", { name: "Sign in to Inboxrake" })).toBeTruthy();
  expect(screen.getByText(window.location.host)).toBeTruthy();
  const field = screen.getByLabelText("Password") as HTMLInputElement;
  expect(field.type).toBe("password");
  expect(field.getAttribute("aria-invalid")).toBeNull();
  expect(document.activeElement).toBe(field);
  expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
    .disabled).toBe(true);
});

test("a correct password signs in", async () => {
  const onLogin = vi.fn();
  render(<Login mode="password" onLogin={onLogin} />);
  type("right");
  submit();
  await waitFor(() => expect(onLogin).toHaveBeenCalled());
  expect(logins).toEqual(["right"]);
});

test("show / hide toggles the field type; the button keeps one name and says pressed", () => {
  render(<Login mode="password" onLogin={() => {}} />);
  const field = screen.getByLabelText("Password") as HTMLInputElement;
  const toggle = screen.getByRole("button", { name: "Show password" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle);
  expect(field.type).toBe("text");
  expect(screen.getByRole("button", { name: "Show password" })
    .getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(toggle);
  expect(field.type).toBe("password");
});

test("a wrong password is an alert tied to the field, worded from the code", async () => {
  reply = { status: 401, body: { detail: "login_wrong_password" } };
  render(<Login mode="password" onLogin={() => {}} />);
  type("nope");
  submit();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Wrong password. Try again.");
  const field = screen.getByLabelText("Password");
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(field.getAttribute("aria-describedby")).toBe(alert.id);
  expect(document.activeElement).toBe(field);
  expect((field as HTMLInputElement).value).toBe("nope");
  expect(alert.className).toContain("bg-keep-bg");
});

test("the throttle says the minutes, in a calm tone", async () => {
  reply = { status: 429, body: { detail: "login_throttled:n=3" } };
  render(<Login mode="password" onLogin={() => {}} />);
  type("x");
  submit();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Too many tries. Wait 3 minutes, then sign in again.");
  expect(alert.className).toContain("bg-review-bg");
});

test("one minute uses the singular text", async () => {
  reply = { status: 429, body: { detail: "login_throttled:n=1" } };
  render(<Login mode="password" onLogin={() => {}} />);
  type("x");
  submit();
  expect((await screen.findByRole("alert")).textContent)
    .toBe("Too many tries. Wait 1 minute, then sign in again.");
});

test("German: the same codes come out in German", async () => {
  setLang("de");
  reply = { status: 401, body: { detail: "login_wrong_password" } };
  render(<Login mode="password" onLogin={() => {}} />);
  fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
  expect((await screen.findByRole("alert")).textContent)
    .toBe("Falsches Passwort. Versuch es noch einmal.");
  expect(screen.getByRole("heading").textContent).toBe("Bei Inboxrake anmelden");
});

test("text the UI has no code for falls back to the generic message", async () => {
  reply = { status: 401, body: { detail: "wrong password" } };   // an older server
  render(<Login mode="password" onLogin={() => {}} />);
  type("x");
  submit();
  expect((await screen.findByRole("alert")).textContent)
    .toBe("Sign-in failed. Try again.");
});

test("a failing network falls back to the generic message too", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  render(<Login mode="password" onLogin={() => {}} />);
  type("x");
  submit();
  expect((await screen.findByRole("alert")).textContent)
    .toBe("Sign-in failed. Try again.");
});

test("the next attempt clears the error", async () => {
  reply = { status: 401, body: { detail: "login_wrong_password" } };
  render(<Login mode="password" onLogin={() => {}} />);
  type("nope");
  submit();
  await screen.findByRole("alert");
  reply = { status: 200, body: { ok: true } };
  submit();
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBeNull();
});

test("password mode links to the reset docs", () => {
  render(<Login mode="password" onLogin={() => {}} />);
  const link = screen.getByRole("link", { name: "How to reset it" });
  expect(link.getAttribute("href")).toBe("https://inboxrake.com/docs/faq/#forgot-the-password");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(screen.getByText(/Forgot the password\?/)).toBeTruthy();
});

test("SSO mode: one primary button, the provider's host under it, no password field", () => {
  render(<Login mode="oidc" idpHost="auth.home.example" onLogin={() => {}} />);
  const a = screen.getByRole("link", { name: "Continue with SSO" });
  expect(a.getAttribute("href")).toBe("/api/oidc/login");
  expect(a.className).toContain("bg-accent");
  expect(screen.getByText("auth.home.example")).toBeTruthy();
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.queryByText("or")).toBeNull();
  expect(screen.getByRole("link", { name: "Trouble signing in?" })
    .getAttribute("href")).toContain("#forgot-the-password");
});

test("SSO mode without a known host shows none", () => {
  render(<Login mode="oidc" onLogin={() => {}} />);
  expect(screen.getByRole("link", { name: "Continue with SSO" })).toBeTruthy();
  expect(screen.queryByText(/\.example/)).toBeNull();
});

test.each([
  ["email_unverified", "Your SSO account has no verified email address.", "bg-keep-bg"],
  ["idp_unavailable", "The sign-in provider isn't reachable. Try again in a moment.",
    "bg-review-bg"],
  ["whatever", "Sign-in failed. Try again.", "bg-keep-bg"],
])("?login_error=%s is worded on the SSO page and removed from the URL",
  (code, text, tone) => {
    window.history.replaceState(null, "", `/?login_error=${code}`);
    render(<Login mode="oidc" onLogin={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(text);
    expect(alert.className).toContain(tone);
    expect(window.location.search).toBe("");
    // the button is still there to try again
    expect(screen.getByRole("link", { name: "Continue with SSO" })).toBeTruthy();
  });

test("?login_error= in German", () => {
  setLang("de");
  window.history.replaceState(null, "", "/?login_error=idp_unavailable");
  render(<Login mode="oidc" onLogin={() => {}} />);
  expect(screen.getByRole("alert").textContent)
    .toBe("Der Anmeldedienst ist nicht erreichbar. Versuch es gleich noch einmal.");
  expect(screen.getByRole("link", { name: "Weiter mit SSO" })).toBeTruthy();
});

test("no error, no alert", () => {
  render(<Login mode="oidc" onLogin={() => {}} />);
  expect(screen.queryByRole("alert")).toBeNull();
});
