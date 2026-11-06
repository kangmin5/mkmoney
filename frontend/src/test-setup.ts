import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals 미사용 환경에서는 자동 정리가 없으므로 테스트마다 렌더 결과를 지운다.
afterEach(() => cleanup());
