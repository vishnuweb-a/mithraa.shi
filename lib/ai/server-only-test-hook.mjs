// Unit-test-only Node resolver for the Next.js "server-only" build guard.
// Next.js must still enforce that guard in production builds. This hook is
// loaded ONLY by the runner's Node unit test, never by app/ or user routes.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
