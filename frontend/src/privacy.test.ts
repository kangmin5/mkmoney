import { describe, expect, it } from 'vitest';

// 앱 소스(테스트 제외)와 index.html을 문자열로 읽어 외부 요청 가능성을 점검한다.
const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./test/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const indexHtml = (import.meta.glob('../index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['../index.html'];

describe('privacy boundary', () => {
  it('ships no absolute external URLs in app source or index.html', () => {
    const offenders = Object.entries({ ...sources, 'index.html': indexHtml })
      .filter(([, text]) => /https?:\/\/(?!localhost|127\.0\.0\.1)/.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('calls fetch only from the same-origin API client', () => {
    const callers = Object.entries(sources).filter(([, text]) => /\bfetch\(/.test(text)).map(([file]) => file);
    expect(callers).toEqual(['./api/client.ts']);
    expect(sources['./api/client.ts']).toMatch(/credentials: "same-origin"/);
  });

  it('never persists data in browser storage', () => {
    const storageUsers = Object.entries(sources).filter(([, text]) => /localStorage|sessionStorage|indexedDB/.test(text)).map(([file]) => file);
    expect(storageUsers).toEqual([]);
  });
});
