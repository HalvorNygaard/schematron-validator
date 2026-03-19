import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';

import type { ValidationIssue, ValidationResponse } from './core/models/validation.models';
import { ValidationService } from './core/services/validation.service';
import {
  buildLineNumbers,
  detectLocalDocumentHint,
  highlightXml,
  type LocalDocumentHint,
  prettyPrintXml,
} from './xml-editor.utils';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class App {
  private readonly validationService = inject(ValidationService);

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
      const result = await this.validationService.validate(xml);
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Validation failed.';
}
