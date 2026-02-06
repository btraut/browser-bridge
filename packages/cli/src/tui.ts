type CheckboxChoice<T> = {
  value: T;
  label: string;
  checked?: boolean;
  disabled?: boolean | string;
};

export const requireTty = (): void => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive install requires a TTY.');
  }
};

export const checkboxPrompt = async <T>(options: {
  message: string;
  choices: CheckboxChoice<T>[];
}): Promise<T[]> => {
  // @inquirer/prompts is ESM; load lazily from our CommonJS bundle.
  const mod = (await import('@inquirer/prompts')) as unknown as {
    checkbox: (args: {
      message: string;
      loop?: boolean;
      choices: Array<{
        value: unknown;
        name: string;
        checked?: boolean;
        disabled?: boolean | string;
      }>;
    }) => Promise<unknown[]>;
  };

  const { checkbox } = mod;
  const values = await checkbox({
    message: options.message,
    // Avoid wrapping from bottom -> top (and top -> bottom) when navigating long lists.
    loop: false,
    choices: options.choices.map((c) => ({
      value: c.value as unknown,
      name: c.label,
      checked: c.checked,
      disabled: c.disabled,
    })),
  });
  return values as T[];
};
