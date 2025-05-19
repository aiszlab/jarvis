import { rimrafSync } from "rimraf";

function remove(pathname?: string) {
  if (!pathname) {
    console.error("pathname is required");
    return;
  }

  rimrafSync(pathname);
}

export { remove };
