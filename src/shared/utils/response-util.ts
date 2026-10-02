import type { OpenAPIHonoOptions, z } from "@hono/zod-openapi";
import type { Env } from "hono";
import { ErrorResponseSchema } from "../schemas";

export interface Response<T> {
  success: boolean;
  code: number;
  message: string;
  data?: T;
}

export const createResponse = <T>(
  data: T,
  options?: {
    success?: boolean;
    code?: number;
    message?: string;
  },
): Response<T> => {
  const { success = true, code = 200, message = "Success" } = options || {};

  return {
    success,
    code,
    message,
    data,
  };
};

export const createErrorResponse = (message: string, code: number = 400) => {
  return {
    success: false,
    code,
    message,
  };
};

/** "path: message; ..." for every zod issue. */
export const formatZodIssues = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

/**
 * defaultHook for OpenAPIHono: invalid input gets the usual envelope (code 400, HTTP 200) instead
 * of zod's raw error object.
 */
export const validationHook: NonNullable<OpenAPIHonoOptions<Env>["defaultHook"]> = (result, c) => {
  if (result.success) return;
  return c.json(
    createErrorResponse(`Invalid ${result.target}: ${formatZodIssues(result.error)}`, 400),
    200,
  );
};

export const createRouteResponses = <T extends z.ZodTypeAny>(
  successSchema: T,
  options?: {
    successDescription?: string;
    includeErrorResponses?: boolean;
  },
) => {
  const { successDescription = "Success", includeErrorResponses = false } = options || {};

  const responses: Record<
    number,
    {
      content: Record<
        string,
        {
          schema: z.ZodTypeAny;
        }
      >;
      description: string;
    }
  > = {
    200: {
      content: {
        "application/json": {
          schema: successSchema,
        },
      },
      description: successDescription,
    },
  };

  if (includeErrorResponses) {
    responses[400] = {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Bad Request",
    };

    responses[404] = {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Not Found",
    };

    responses[500] = {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Internal Server Error",
    };
  }

  return responses;
};
