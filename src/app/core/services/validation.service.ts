import { Injectable } from '@angular/core';

import type { ValidationResponse } from '../models/validation.models';

declare global {
  interface Window {
    saxonJsValidator?: {
      validate: (xml: string) => Promise<ValidationResponse>;
    };
  }
}

@Injectable({
  providedIn: 'root',
})
export class ValidationService {
  async validate(xml: string): Promise<ValidationResponse> {
    const validator = window.saxonJsValidator;

    if (!validator) {
      throw new Error('Validator runtime is not loaded. Refresh the page and try again.');
    }

    return validator.validate(xml);
  }
}
