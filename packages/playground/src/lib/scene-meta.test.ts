import { expect, test } from "bun:test";
import { parseSceneMeta } from "./scene-meta";

test("parseSceneMeta reads Key: Value lines from the first comment block", () => {
  expect(
    parseSceneMeta(`/* Author: LottieFiles
   Author URL: https://lottiefiles.com/ */
/* Converted Lottie — "Free Magic eye Animation" */
#a { fill: red; }`),
  ).toEqual({
    Author: "LottieFiles",
    "Author URL": "https://lottiefiles.com/",
  });
});

test("parseSceneMeta ignores prose colons and later comments", () => {
  expect(
    parseSceneMeta(`/* Hierarchy — the lesson: groups compose.
   Two machines run concurrently: */
/* Author: nope */
#a { fill: red; }`),
  ).toEqual({});
});
