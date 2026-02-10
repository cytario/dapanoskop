import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("workload/:name", "routes/workload-detail.tsx"),
] satisfies RouteConfig;
