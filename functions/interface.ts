// Interface to store interface details for comparison
export interface InterfaceInfo {
  name: string;
  filePath: string;
  properties: { name: string; type: string }[];
}
