export {};
declare global {
  interface Window {
    desktopBridge?: {
      listSources(): Promise<Array<{ id: string; name: string; thumbnail: string }>>;
      selectSource(id: string): Promise<void>;
    };
  }
}
