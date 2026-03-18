import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';

import type { ValidationIssue, ValidationResponse } from './core/models/validation.models';
import { ValidationApiService } from './core/services/validation-api.service';

type LocalDocumentHint = {
  hasXmlDeclaration: boolean;
  rootElement: string | null;
};

const XML_INDENT = '    ';
const INLINE_TEXT_LIMIT = 72;
const WRAP_ATTRIBUTE_LINE_LIMIT = 96;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  encapsulation: ViewEncapsulation.None,
})
export class App {
  private readonly validationApi = inject(ValidationApiService);

  protected readonly xmlInput = signal('');
  protected readonly selectedFileName = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly validationResult = signal<ValidationResponse | null>(null);
  protected readonly isDragging = signal(false);
  protected readonly isValidating = signal(false);

  protected readonly localDocumentHint = computed<LocalDocumentHint>(() =>
    detectLocalDocumentHint(this.xmlInput()),
  );
  protected readonly highlightedXml = computed(() => highlightXml(this.xmlInput()));
  protected readonly lineNumbers = computed(() => buildLineNumbers(this.xmlInput()));

  protected readonly summary = computed(() => this.validationResult()?.summary ?? null);
  protected readonly issues = computed(() => this.validationResult()?.issues ?? []);

  protected onXmlInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.xmlInput.set(value);
    this.errorMessage.set(null);
    this.validationResult.set(null);
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    if (file) {
      await this.loadXmlFile(file);
    }

    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragging.set(false);

    const file = event.dataTransfer?.files?.[0] ?? null;
    if (!file) {
      return;
    }

    await this.loadXmlFile(file);
  }

  protected async validate(): Promise<void> {
    const xml = this.xmlInput().trim();

    if (!xml) {
      this.errorMessage.set('Paste or drop an XML document before validating.');
      this.validationResult.set(null);
      return;
    }

    this.isValidating.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.validationApi.validate(xml);
      this.validationResult.set(result);
    } catch (error) {
      this.validationResult.set(null);
      this.errorMessage.set(getErrorMessage(error));
    } finally {
      this.isValidating.set(false);
    }
  }

  protected trackIssue(index: number, issue: ValidationIssue): string {
    return `${issue.id}-${issue.location}-${index}`;
  }

  protected formatXml(): void {
    const xml = this.xmlInput().trim();

    if (!xml) {
      return;
    }

    const formatted = prettyPrintXml(xml);

    if (!formatted) {
      this.errorMessage.set('The XML could not be formatted. Check that it is well-formed first.');
      return;
    }

    this.xmlInput.set(formatted);
    this.errorMessage.set(null);
  }

  protected syncEditorScroll(event: Event, highlightLayer: HTMLElement): void {
    const target = event.target as HTMLTextAreaElement;
    highlightLayer.scrollTop = target.scrollTop;
    highlightLayer.scrollLeft = target.scrollLeft;
  }

  protected syncLineNumberScroll(event: Event, lineNumberLayer: HTMLElement): void {
    const target = event.target as HTMLTextAreaElement;
    lineNumberLayer.scrollTop = target.scrollTop;
  }

  private async loadXmlFile(file: File): Promise<void> {
    const text = await file.text();
    this.selectedFileName.set(file.name);
    this.xmlInput.set(prettyPrintXml(text) ?? text);
    this.errorMessage.set(null);
    this.validationResult.set(null);
  }
}

function detectLocalDocumentHint(xml: string): LocalDocumentHint {
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Validation failed.';
}

function highlightXml(xml: string): string {
  if (!xml) {
    return '';
  }

  const tokenPattern =
    /<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>|<\/?[\w:.-]+(?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*\/?>/g;
  let output = '';
  let lastIndex = 0;

  for (const match of xml.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    output += escapeHtml(xml.slice(lastIndex, index));
    output += renderXmlToken(match[0]);
    lastIndex = index + match[0].length;
  }

  output += escapeHtml(xml.slice(lastIndex));
  return output;
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

  const attributePattern = /(\s+)([\w:.-]+)(\s*=\s*(?:"[^"]*"|'[^']*'))?/g;
  let output = '';
  let lastIndex = 0;

  for (const match of rawAttributes.matchAll(attributePattern)) {
    const index = match.index ?? 0;
    output += escapeHtml(rawAttributes.slice(lastIndex, index));
    output += escapeHtml(match[1]);
    output += `<span class="token attr-name">${escapeHtml(match[2])}</span>`;

    const assignment = match[3];
    if (assignment) {
      const [, quote = '', value = ''] = assignment.match(/(\s*=\s*)(.*)/) ?? [];
      output += escapeHtml(quote);
      output += `<span class="token attr-value">${escapeHtml(value)}</span>`;
    }

    lastIndex = index + match[0].length;
  }

  output += escapeHtml(rawAttributes.slice(lastIndex));
  return output;
}

function prettyPrintXml(xml: string): string | null {
  const xmlDeclaration = xml.match(/^\s*<\?xml[\s\S]*?\?>/i)?.[0]?.trim() ?? null;
  const parser = new DOMParser();
  const parsed = parser.parseFromString(xml, 'application/xml');

  if (parsed.querySelector('parsererror')) {
    return null;
  }

  const body = serializeXmlNode(parsed.documentElement, 0);
  return xmlDeclaration ? `${xmlDeclaration}\n${body}` : body;
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

function buildLineNumbers(xml: string): string[] {
  const lineCount = Math.max(xml.split('\n').length, 1);
  return Array.from({ length: lineCount }, (_, index) => String(index + 1));
}
