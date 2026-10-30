/**
 * What a field is called and does, in words: the admin panel's labels and help, and the field
 * descriptions MCP clients see. Attached to each field schema with .meta(), so JSON Schema
 * (z.toJSONSchema) carries it as title, description and unit.
 */
export type SettingText = {
  title: string;
  description: string;
  unit?: string;
};

export const field = (title: string, description: string, unit?: string): SettingText => (unit === undefined ? { title, description } : { title, description, unit });
