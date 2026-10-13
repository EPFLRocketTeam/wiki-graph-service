import { config, graphqlEndpoint } from "./config";

/**
 * Thin client around the Wiki.js GraphQL API.
 *
 * NOTE: the exact field names below (`locale`, `content`) are based on the
 * documented/typical Wiki.js 2.x schema, but we have not yet run a live
 * introspection query against this wiki's own /graphql endpoint. The first
 * time this runs against the real instance, if either query errors out with
 * "Cannot query field X", open <WIKI_BASE_URL>/graphql in a browser (Wiki.js
 * ships a GraphQL Playground there) and check the Page / PageListItem types
 * in the schema docs panel, then adjust the queries below.
 */

export interface WikiPageListItem {
  id: number;
  path: string;
  title: string;
  locale: string;
}

export interface WikiPageContent {
  id: number;
  path: string;
  locale: string;
  content: string;
}

async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(graphqlEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.wikiApiToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Wiki.js GraphQL request failed: ${res.status} ${res.statusText} ${body}`
    );
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(
      `Wiki.js GraphQL returned errors: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }

  if (!json.data) {
    throw new Error("Wiki.js GraphQL response had no data");
  }

  return json.data;
}

const LIST_PAGES_QUERY = /* GraphQL */ `
  query ListPages {
    pages {
      list(orderBy: TITLE) {
        id
        path
        title
        locale
      }
    }
  }
`;

export async function listPages(): Promise<WikiPageListItem[]> {
  const data = await graphqlRequest<{ pages: { list: WikiPageListItem[] } }>(
    LIST_PAGES_QUERY
  );
  return data.pages.list;
}

const PAGE_CONTENT_QUERY = /* GraphQL */ `
  query PageContent($id: Int!) {
    pages {
      single(id: $id) {
        id
        path
        locale
        content
      }
    }
  }
`;

export async function getPageContent(id: number): Promise<WikiPageContent | null> {
  const data = await graphqlRequest<{ pages: { single: WikiPageContent | null } }>(
    PAGE_CONTENT_QUERY,
    { id }
  );
  return data.pages.single;
}
