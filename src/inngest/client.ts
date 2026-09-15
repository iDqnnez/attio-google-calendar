import { Inngest } from "inngest";

// INNGEST_DEV=1 is set via env for local development. Never hardcode isDev.
export const inngest = new Inngest({
  id: "attio-google-calendar",
  checkpointing: {
    maxRuntime: "240s",
  },
});
