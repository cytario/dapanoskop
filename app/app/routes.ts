import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("workload/:name", "routes/workload-detail.tsx"),
  route("cost-center/:name", "routes/cost-center-detail.tsx"),
  route("storage", "routes/storage.tsx"),
] satisfies RouteConfig;
