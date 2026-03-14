import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { InspectError } from './errors';
import type { ExtractContentResult } from './types';

type ReadabilityArticle = NonNullable<ReturnType<Readability['parse']>>;

type SemanticMainCandidate = {
  html: string;
  text: string;
  tagName: string;
};

const normalizeExtractedText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const collapseRepeatedMarkdownBlocks = (markdown: string): string => {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  for (
    let sequenceLength = Math.floor(blocks.length / 2);
    sequenceLength >= 1;
    sequenceLength -= 1
  ) {
    for (
      let start = 0;
      start + sequenceLength * 2 <= blocks.length;
      start += 1
    ) {
      const first = blocks
        .slice(start, start + sequenceLength)
        .map((block) => normalizeExtractedText(block))
        .join('\n');
      const second = blocks
        .slice(start + sequenceLength, start + sequenceLength * 2)
        .map((block) => normalizeExtractedText(block))
        .join('\n');
      if (first.length === 0 || first !== second) {
        continue;
      }
      blocks.splice(start + sequenceLength, sequenceLength);
      sequenceLength = Math.min(
        sequenceLength + 1,
        Math.floor(blocks.length / 2)
      );
      start = Math.max(start - 1, -1);
    }
  }
  return blocks.join('\n\n').trim();
};

const extractSemanticMainCandidate = (
  document: JSDOM['window']['document']
): SemanticMainCandidate | null => {
  const candidates = Array.from(
    document.querySelectorAll('main, [role="main"], article')
  );
  let best = candidates[0] ?? null;
  let bestLength = 0;
  for (const candidate of candidates) {
    const text = normalizeExtractedText(candidate.textContent ?? '');
    if (text.length <= bestLength) {
      continue;
    }
    best = candidate;
    bestLength = text.length;
  }
  if (!best || bestLength === 0) {
    return null;
  }
  return {
    html: best.innerHTML,
    text: normalizeExtractedText(best.textContent ?? ''),
    tagName: best.tagName.toLowerCase(),
  };
};

const shouldPreferSemanticMainCandidate = (options: {
  articleText: string;
  mainText: string;
  mainTagName: string;
}): boolean => {
  const articleLength = normalizeExtractedText(options.articleText).length;
  const mainLength = normalizeExtractedText(options.mainText).length;
  if (mainLength === 0) {
    return false;
  }
  if (articleLength === 0) {
    return true;
  }
  if (options.mainTagName === 'article') {
    return false;
  }
  return articleLength < 160 && mainLength > articleLength + 20;
};

export const parseExtractContentSource = (options: {
  html: string;
  url: string;
}): {
  article: ReadabilityArticle;
  semanticMainCandidate: SemanticMainCandidate | null;
} => {
  let article: ReturnType<Readability['parse']> | null = null;
  let semanticMainCandidate: SemanticMainCandidate | null = null;
  try {
    const dom = new JSDOM(options.html, { url: options.url });
    const reader = new Readability(dom.window.document);
    article = reader.parse();
    semanticMainCandidate = extractSemanticMainCandidate(dom.window.document);
  } catch {
    throw new InspectError(
      'EVALUATION_FAILED',
      'Failed to parse page content.',
      {
        retryable: false,
      }
    );
  }

  if (!article) {
    throw new InspectError(
      'NOT_SUPPORTED',
      'Readability could not extract content.',
      {
        retryable: false,
      }
    );
  }

  return {
    article,
    semanticMainCandidate,
  };
};

export const renderExtractContent = (options: {
  format: 'markdown' | 'text' | 'article_json';
  article: ReadabilityArticle;
  semanticMainCandidate: SemanticMainCandidate | null;
  includeMetadata?: boolean;
  warnings?: string[];
}): ExtractContentResult => {
  let content = '';
  if (options.format === 'article_json') {
    content = JSON.stringify(options.article, null, 2);
  } else if (options.format === 'text') {
    const articleText = options.article.textContent ?? '';
    if (
      options.semanticMainCandidate &&
      shouldPreferSemanticMainCandidate({
        articleText,
        mainText: options.semanticMainCandidate.text,
        mainTagName: options.semanticMainCandidate.tagName,
      })
    ) {
      content = options.semanticMainCandidate.text;
    } else {
      content = articleText;
    }
  } else {
    const turndown = new TurndownService();
    const articleText = options.article.textContent ?? '';
    const sourceHtml =
      options.semanticMainCandidate &&
      shouldPreferSemanticMainCandidate({
        articleText,
        mainText: options.semanticMainCandidate.text,
        mainTagName: options.semanticMainCandidate.tagName,
      })
        ? options.semanticMainCandidate.html
        : (options.article.content ?? '');
    content = collapseRepeatedMarkdownBlocks(turndown.turndown(sourceHtml));
  }

  const includeMetadata = options.includeMetadata ?? true;
  return {
    content,
    ...(includeMetadata
      ? {
          title: options.article.title ?? undefined,
          byline: options.article.byline ?? undefined,
          excerpt: options.article.excerpt ?? undefined,
          siteName:
            (options.article as { siteName?: string }).siteName ?? undefined,
        }
      : {}),
    ...(options.warnings && options.warnings.length > 0
      ? { warnings: options.warnings }
      : {}),
  };
};
