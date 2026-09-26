// A line of text whose mention of the History page is a link to it (stage-5.md §6.7: every former
// "Stage 5" text on the Stage 3–4 pages is a present-tense line with a link). The link is the
// last "History page" or "History" in parentheses; a text without one renders as it is.
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

const TARGETS = ['History page', '(History)'] as const;

export function HistoryLinkText({ text }: { text: string }): JSX.Element {
  for (const target of TARGETS) {
    const at = text.lastIndexOf(target);
    if (at === -1) continue;
    const word = target === '(History)' ? 'History' : target;
    const start = target === '(History)' ? at + 1 : at;
    return (
      <>
        {text.slice(0, start)}
        <Link to="/history">{word}</Link>
        {text.slice(start + word.length)}
      </>
    );
  }
  return <>{text}</>;
}
