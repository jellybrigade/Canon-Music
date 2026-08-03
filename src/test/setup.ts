// Runs before every test file, in both the node and jsdom environments.
//
// jest-dom's matchers are only meaningful in jsdom, but registering them in node is harmless
// and keeps a single setup file, so a component test never fails because it forgot one.
import "@testing-library/jest-dom/vitest";
