export type LocalDocumentHint = {
  hasXmlDeclaration: boolean;
  rootElement: string | null;
};

const XML_INDENT = '    ';
const INLINE_TEXT_LIMIT = 72;
const WRAP_ATTRIBUTE_LINE_LIMIT = 96;
const XML_TOKEN_PATTERN =
  /<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>|<\/?[\w:.-]+(?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*\/?>/g;
const XML_ATTRIBUTE_PATTERN = /(\s+)([\w:.-]+)(\s*=\s*(?:"[^"]*"|'[^']*'))?/g;

export function detectLocalDocumentHint(xml: string): LocalDocumentHint {
  const trimmed = xml.trimStart();
  const declaration = trimmed.match(/^<\?xml[\s\S]*?\?>/i)?.[0] ?? null;
  const hasXmlDeclaration = declaration !== null;
  const withoutDeclaration = hasXmlDeclaration ? trimmed.slice(declaration.length) : trimmed;
  const withoutComments = withoutDeclaration.replace(/^(?:\s|<!--[\s\S]*?-->)+/, '');
  const rootElement =
    withoutComments.match(/^<\s*(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b/)?.[1] ?? null;

  return {
    hasXmlDeclaration,
    rootElement,
  };
}

export function highlightXml(xml: string): string {
  if (!xml) {
    return '';
  }

  let output = '';
  let lastIndex = 0;

  for (const match of xml.matchAll(XML_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    output += escapeHtml(xml.slice(lastIndex, index));
    output += renderXmlToken(match[0]);
    lastIndex = index + match[0].length;
  }

  output += escapeHtml(xml.slice(lastIndex));
  return output;
}

export function prettyPrintXml(xml: string): string | null {
  const xmlDeclaration = xml.match(/^\s*<\?xml[\s\S]*?\?>/i)?.[0]?.trim() ?? null;
  const parser = new DOMParser();
  const parsed = parser.parseFromString(xml, 'application/xml');

  if (parsed.querySelector('parsererror') || !parsed.documentElement) {
    return null;
  }

  const body = serializeXmlNode(parsed.documentElement, 0);
  return xmlDeclaration ? `${xmlDeclaration}\n${body}` : body;
}

export function buildLineNumbers(xml: string): string[] {
  const lineCount = Math.max(xml.split('\n').length, 1);
  return Array.from({ length: lineCount }, (_, index) => String(index + 1));
}

function renderXmlToken(token: string): string {
  if (token.startsWith('<!--')) {
    return `<span class="token comment">${escapeHtml(token)}</span>`;
  }

  if (token.startsWith('<?xml')) {
    return renderXmlDeclaration(token);
  }

  return renderXmlTag(token);
}

function renderXmlDeclaration(token: string): string {
  const match = token.match(/^<\?([\w:.-]+)([\s\S]*?)\?>$/);

  if (!match) {
    return escapeHtml(token);
  }

  const [, name, rawAttributes] = match;
  return [
    '<span class="token punctuation">&lt;?</span>',
    `<span class="token tag">${escapeHtml(name)}</span>`,
    renderXmlAttributes(rawAttributes),
    '<span class="token punctuation">?&gt;</span>',
  ].join('');
}

function renderXmlTag(token: string): string {
  const match = token.match(/^<(\/)?([\w:.-]+)([\s\S]*?)(\/?)>$/);

  if (!match) {
    return escapeHtml(token);
  }

  const [, closingSlash, name, rawAttributes, selfClosingSlash] = match;
  const punctuationStart = closingSlash ? '&lt;/' : '&lt;';
  const punctuationEnd = selfClosingSlash ? '/&gt;' : '&gt;';

  return [
    `<span class="token punctuation">${punctuationStart}</span>`,
    `<span class="token tag">${escapeHtml(name)}</span>`,
    renderXmlAttributes(rawAttributes),
    `<span class="token punctuation">${punctuationEnd}</span>`,
  ].join('');
}

function renderXmlAttributes(rawAttributes: string): string {
  if (!rawAttributes) {
    return '';
  }

  let output = '';
  let lastIndex = 0;

  for (const match of rawAttributes.matchAll(XML_ATTRIBUTE_PATTERN)) {
    const index = match.index ?? 0;
    output += escapeHtml(rawAttributes.slice(lastIndex, index));
    output += escapeHtml(match[1]);
    output += `<span class="token attr-name">${escapeHtml(match[2])}</span>`;

    const assignment = match[3];
    if (assignment) {
      const [, prefix = '', value = ''] = assignment.match(/(\s*=\s*)(.*)/) ?? [];
      output += escapeHtml(prefix);
      output += `<span class="token attr-value">${escapeHtml(value)}</span>`;
    }

    lastIndex = index + match[0].length;
  }

  output += escapeHtml(rawAttributes.slice(lastIndex));
  return output;
}

function serializeXmlNode(node: Node, depth: number): string {
  const indent = XML_INDENT.repeat(depth);

  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const children = Array.from(element.childNodes).filter(
      (child) => !isIgnorableWhitespace(child),
    );

    if (!children.length) {
      return buildOpeningTag(element, depth, true);
    }

    if (children.length === 1 && isInlineTextNode(children[0])) {
      return buildInlineTextElement(element, children[0].textContent ?? '', depth);
    }

    const serializedChildren = children
      .map((child) => serializeXmlNode(child, depth + 1))
      .join('\n');

    return `${buildOpeningTag(element, depth, false)}\n${serializedChildren}\n${indent}</${element.tagName}>`;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return `${indent}${escapeText((node.textContent ?? '').trim())}`;
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    return `${indent}<!--${node.textContent ?? ''}-->`;
  }

  if (node.nodeType === Node.CDATA_SECTION_NODE) {
    return `${indent}<![CDATA[${node.textContent ?? ''}]]>`;
  }

  return '';
}

function isIgnorableWhitespace(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim();
}

function isInlineTextNode(node: Node): boolean {
  if (node.nodeType !== Node.TEXT_NODE) {
    return false;
  }

  const value = (node.textContent ?? '').trim();
  return !value.includes('\n') && value.length <= INLINE_TEXT_LIMIT;
}

function buildInlineTextElement(element: Element, text: string, depth: number): string {
  const indent = XML_INDENT.repeat(depth);
  const inlineOpeningTag = buildOpeningTag(element, depth, false);

  if (inlineOpeningTag.includes('\n')) {
    return `${inlineOpeningTag}\n${XML_INDENT.repeat(depth + 1)}${escapeText(text.trim())}\n${indent}</${element.tagName}>`;
  }

  return `${inlineOpeningTag}${escapeText(text.trim())}</${element.tagName}>`;
}

function buildOpeningTag(element: Element, depth: number, selfClosing: boolean): string {
  const indent = XML_INDENT.repeat(depth);
  const attributes = Array.from(element.attributes).map(
    (attribute) => `${attribute.name}="${escapeAttribute(attribute.value)}"`,
  );

  if (!attributes.length) {
    return selfClosing ? `${indent}<${element.tagName}/>` : `${indent}<${element.tagName}>`;
  }

  const singleLineTag = `${indent}<${element.tagName} ${attributes.join(' ')}${selfClosing ? '/>' : '>'}`;

  if (!shouldWrapAttributes(attributes, singleLineTag)) {
    return singleLineTag;
  }

  const lastAttributeIndex = attributes.length - 1;
  return [
    `${indent}<${element.tagName}`,
    ...attributes.map(
      (attribute, index) =>
        `${indent}${XML_INDENT}${attribute}${index === lastAttributeIndex ? (selfClosing ? '/>' : '>') : ''}`,
    ),
  ].join('\n');
}

function shouldWrapAttributes(attributes: string[], singleLineTag: string): boolean {
  return attributes.length > 1 || singleLineTag.length > WRAP_ATTRIBUTE_LINE_LIMIT;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}
