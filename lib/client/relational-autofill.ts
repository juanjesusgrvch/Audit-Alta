export type RelationalOptionsMap<K extends string> = Record<K, string[]>;

type SyncRelationalFieldArgs<K extends string> = {
  autoFilledFields: Set<K>;
  fields: readonly K[];
  getValue: (field: K) => string;
  manualFields?: Set<K>;
  optionsByField: RelationalOptionsMap<K>;
};

type SyncRelationalFieldResult<K extends string> = {
  nextAutoFilledFields: Set<K>;
  updates: Array<{
    autoFilled: boolean;
    field: K;
    value: string;
  }>;
};

function normalizeOptionList(options: string[]) {
  return [...new Set(options.map((option) => option.trim()).filter(Boolean))];
}

export function syncRelationalAutoFilledFields<K extends string>({
  autoFilledFields,
  fields,
  getValue,
  manualFields,
  optionsByField,
}: SyncRelationalFieldArgs<K>): SyncRelationalFieldResult<K> {
  const nextAutoFilledFields = new Set(autoFilledFields);
  const updates: Array<{
    autoFilled: boolean;
    field: K;
    value: string;
  }> = [];

  for (const field of fields) {
    const currentValue = getValue(field).trim();
    const options = normalizeOptionList(optionsByField[field] ?? []);
    const wasAutoFilled = nextAutoFilledFields.has(field);
    const isManualField = manualFields?.has(field) ?? false;

    if (isManualField && !wasAutoFilled) {
      nextAutoFilledFields.delete(field);
      continue;
    }

    if (options.length === 1) {
      const nextValue = options[0];

      if (!currentValue || wasAutoFilled) {
        if (currentValue !== nextValue) {
          updates.push({
            autoFilled: true,
            field,
            value: nextValue,
          });
        }

        nextAutoFilledFields.add(field);
        continue;
      }

      nextAutoFilledFields.delete(field);
      continue;
    }

    if (wasAutoFilled) {
      if (currentValue) {
        updates.push({
          autoFilled: false,
          field,
          value: "",
        });
      }

      nextAutoFilledFields.delete(field);
    }
  }

  return {
    nextAutoFilledFields,
    updates,
  };
}
