// @vitest-environment jsdom
/* `#/connect`: the consent page of a hosted app. The API is mocked; the page
 * must show who asks (the host, large), never focus Deny or Allow, send the
 * choices of the user and follow only the redirect URL the server returns. */

import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor,
  within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ConnectDecision, ConnectRequest } from "../types";

const REQ: ConnectRequest = {
  request_id: "rid-1",
  client: { client_id: "https://claude.example/client.json",
    host: "claude.example", name: "Claude", redirect_host: "claude.example" },
  ceiling: "propose", accounts: ["proton", "icloud"],
  defaults: { level: "read", subjects: false, expires_days: 90,
    daily_cap: 2000, name: "Claude · claude.example" },
};
const BACK = "https://claude.example/cb?code=irc_x&state=s&iss=https%3A%2F%2Fmail.example";

let getResult: () => Promise<unknown> = () => Promise.resolve(REQ);
let postResult: (b: ConnectDecision) => Promise<unknown> =
  () => Promise.resolve({ redirect_url: BACK });
const posted: ConnectDecision[] = [];
let gets = 0;
vi.mock("../api", () => ({
  api: {
    assistantConnect: () => { gets += 1; return getResult(); },
    assistantConnectDecide: (b: ConnectDecision) => { posted.push(b);
      return postResult(b); },
  },
  errorText: (m: unknown) => String(m),
}));

import { ConnectPage } from "./ConnectPage";
import { DialogProvider, ToastProvider } from "./ui";
import { setLang } from "../i18n";

const navigate = vi.fn();
const left = vi.fn();
const render = (ui: ReactElement) =>
  rtlRender(<ToastProvider><DialogProvider>{ui}</DialogProvider></ToastProvider>);
const show = async () => {
  render(<ConnectPage onLeave={left} navigate={navigate} />);
  await act(async () => {});
};
const coded = (code: string, message = code) =>
  Object.assign(new Error(message), { code });

beforeEach(() => {
  getResult = () => Promise.resolve(REQ);
  postResult = () => Promise.resolve({ redirect_url: BACK });
  posted.length = 0; gets = 0; navigate.mockReset(); left.mockReset();
});
afterEach(() => { cleanup(); setLang("en"); });

test("the client_id host leads, the name is secondary, the redirect host and the notice are shown", async () => {
  await show();
  const h1 = screen.getByRole("heading", { level: 1 });
  expect(h1.textContent).toBe("claude.examplewants to access your Inboxrake");
  expect(within(h1).getByText("claude.example").className)
    .toMatch(/type-largetitle/);
  expect(screen.getByText("It calls itself “Claude”. That is its own claim."))
    .toBeTruthy();
  expect(screen.getByText("After you decide, you go back to claude.example."))
    .toBeTruthy();
  expect(screen.getByText(/Only continue if you started connecting this app yourself, just now/))
    .toBeTruthy();
});

test("the self-asserted name is left out when it is just the host", async () => {
  getResult = () => Promise.resolve({ ...REQ, client: { ...REQ.client,
    name: "claude.example" } });
  await show();
  expect(screen.queryByText(/It calls itself/)).toBeNull();
});

test("no app shell, and neither Deny nor Allow (nor anything) has focus", async () => {
  await show();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(document.activeElement).toBe(document.body);
  expect(screen.getByRole("button", { name: "Deny" })).not.toBe(document.activeElement);
  expect(screen.getByRole("button", { name: "Allow" })).not.toBe(document.activeElement);
});

test("the choices start from the server's defaults; levels above the ceiling are disabled", async () => {
  await show();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value)
    .toBe("Claude · claude.example");
  expect(screen.getByRole("radio", { name: /^Read$/ })
    .getAttribute("aria-checked")).toBe("true");
  const act = screen.getByRole("radio", { name: /Read, propose and act/ });
  expect(act.hasAttribute("disabled")
    || act.getAttribute("aria-disabled") === "true").toBe(true);
  expect(screen.getByText("More than this app asked for, or your admin allows."))
    .toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "proton" })).toHaveProperty("checked", true);
});

test("Allow sends the user's choices and follows the returned redirect URL", async () => {
  await show();
  fireEvent.click(screen.getByRole("radio", { name: /Read and propose rules/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "icloud" }));
  fireEvent.click(screen.getByRole("switch", { name: "Include subject lines" }));
  fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
  fireEvent.change(screen.getByLabelText("Name"),
    { target: { value: " Work Claude " } });
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(BACK));
  expect(posted).toEqual([{ request_id: "rid-1", approve: true,
    name: "Work Claude", accounts: ["proton"], level: "propose",
    subjects: true, expires_days: 30 }]);
  // while the browser leaves, the page says where to
  expect(screen.getByText("Going back to claude.example…")).toBeTruthy();
});

test("Allow with no account or no name asks for it and sends nothing", async () => {
  await show();
  fireEvent.click(screen.getByRole("checkbox", { name: "proton" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "icloud" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: " " } });
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  expect(await screen.findByText("Choose at least one account.")).toBeTruthy();
  expect(screen.getByText("Give the token a name.")).toBeTruthy();
  expect(posted).toEqual([]);
  expect(navigate).not.toHaveBeenCalled();
});

test("Deny needs no choices and sends approve: false", async () => {
  await show();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(BACK));
  expect(posted).toEqual([{ request_id: "rid-1", approve: false }]);
});

test("Act sends its daily limit; other levels send none", async () => {
  getResult = () => Promise.resolve({ ...REQ, ceiling: "act" });
  await show();
  fireEvent.click(screen.getByRole("radio", { name: /Read, propose and act/ }));
  expect(screen.getByText(/Mail can contain text written to trick an assistant/))
    .toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(posted.length).toBe(1));
  expect(posted[0]).toMatchObject({ level: "act", daily_cap: 2000 });
});

test("a refusal that has no safe place to go back to is shown here, never followed", async () => {
  getResult = () => Promise.reject(coded("connect_redirect_uri",
    "The app asked to return to an address it has not registered."));
  await show();
  expect(screen.getByRole("heading", { level: 1 }).textContent)
    .toBe("This connection can't be set up");
  expect(screen.getByRole("alert").textContent)
    .toMatch(/has not registered/);
  expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open Inboxrake" }));
  expect(left).toHaveBeenCalled();
});

test("an uncoded failure (a server without OAuth answers 404) reads as unavailable", async () => {
  getResult = () => Promise.reject(new Error("not found"));
  await show();
  expect(screen.getByRole("alert").textContent)
    .toBe("Hosted apps can't connect to this server right now.");
});

test("errors the server redirects (bad PKCE, wrong resource) are followed at once", async () => {
  getResult = () => Promise.resolve({ redirect_url:
    "https://claude.example/cb?error=invalid_request&state=s&iss=x" });
  await show();
  expect(navigate).toHaveBeenCalledWith(
    "https://claude.example/cb?error=invalid_request&state=s&iss=x");
  expect(screen.getByText("Going back to claude.example…")).toBeTruthy();
});

test("the request is read once, however often the page renders", async () => {
  const { rerender } = rtlRender(<ConnectPage onLeave={left} navigate={navigate} />);
  rerender(<ConnectPage onLeave={left} navigate={navigate} />);
  await act(async () => {});
  expect(gets).toBe(1);
});

test("a name in use is shown at the name field and Allow can be tried again", async () => {
  postResult = () => Promise.reject(coded("name_taken"));
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  expect(await screen.findByText(/This name is already used/)).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Allow" }).hasAttribute("disabled"))
    .toBe(false);
});

test("another refusal of the decision (level above the ceiling) is shown above the buttons", async () => {
  postResult = () => Promise.reject(coded("connect_level_above_ceiling",
    "That level is more than this app asked for."));
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  expect((await screen.findByRole("alert")).textContent)
    .toMatch(/more than this app asked for/);
  expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
  // a refused decision never leaves the page
  expect(navigate).not.toHaveBeenCalled();
});

test("the app's host and name are text, never markup", async () => {
  getResult = () => Promise.resolve({ ...REQ, client: { ...REQ.client,
    host: "<b>x</b>.example", name: "<img src=x onerror=alert(1)>",
    redirect_host: "<i>y</i>.example" },
  defaults: { ...REQ.defaults, name: "<b>x</b>" } });
  await show();
  const page = document.body;
  expect(screen.getByRole("heading", { level: 1 }).textContent)
    .toContain("<b>x</b>.example");
  expect(page.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(page.textContent).toContain("<i>y</i>.example");
  expect(page.querySelector("img, b, i, script")).toBeNull();
});

test("a request that is gone ends the page with the reason and a way out", async () => {
  postResult = () => Promise.reject(coded("connect_request_gone",
    "This request has expired."));
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  expect(await screen.findByText("This connection can't be set up")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("This request has expired.");
  expect(navigate).not.toHaveBeenCalled();
});

test("German: du, the host still leads", async () => {
  setLang("de");
  await show();
  expect(screen.getByRole("heading", { level: 1 }).textContent)
    .toBe("claude.examplemöchte auf dein Inboxrake zugreifen");
  expect(screen.getByRole("button", { name: "Erlauben" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ablehnen" })).toBeTruthy();
  expect(screen.getByText(/Mach nur weiter, wenn du das Verbinden/)).toBeTruthy();
});
