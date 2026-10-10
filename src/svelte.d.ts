declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}

declare module "virtual:simustyle-standalone-runtime" {
  const bundle: string;
  export default bundle;
}
