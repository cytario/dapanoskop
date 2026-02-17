import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("workload/:name", "routes/workload-detail.tsx"),
  route("cost-center/:name", "routes/cost-center-detail.tsx"),
  route("storage-cost", "routes/storage-cost-detail.tsx"),
  route("storage-detail", "routes/storage-detail.tsx"),
] satisfies RouteConfig;
