import { CliError } from './cli-output';

type LocatorRoleInput = {
  name: string;
  value?: string;
};

export type LocatorInput = {
  testid?: string;
  css?: string;
  text?: string;
  role?: LocatorRoleInput;
};

type LocatorOptions = {
  locatorTestid?: string;
  locatorCss?: string;
  locatorText?: string;
  locatorRole?: string;
  locatorRoleValue?: string;
};

export const buildLocator = (
  options: LocatorOptions
): LocatorInput | undefined => {
  const locator: LocatorInput = {};

  if (options.locatorTestid) {
    locator.testid = options.locatorTestid;
  }

  if (options.locatorCss) {
    locator.css = options.locatorCss;
  }

  if (options.locatorText) {
    locator.text = options.locatorText;
  }

  if (options.locatorRoleValue && !options.locatorRole) {
    throw new CliError({
      code: 'INVALID_ARGUMENT',
      message: 'locator-role-value requires locator-role to be set.',
      retryable: false,
      details: { field: 'locator.role.value' },
    });
  }

  if (options.locatorRole) {
    locator.role = {
      name: options.locatorRole,
      ...(options.locatorRoleValue ? { value: options.locatorRoleValue } : {}),
    };
  }

  if (!locator.testid && !locator.css && !locator.text && !locator.role) {
    return undefined;
  }

  return locator;
};

export const requireLocator = (options: LocatorOptions): LocatorInput => {
  const locator = buildLocator(options);
  if (!locator) {
    throw new CliError({
      code: 'INVALID_ARGUMENT',
      message: 'Locator must include at least one selector.',
      retryable: false,
      details: { field: 'locator' },
    });
  }
  return locator;
};
