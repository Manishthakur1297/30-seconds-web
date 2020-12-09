import chokidar from 'chokidar';
import paths from 'settings/paths';
import fs from 'fs-extra';
import { Snippet } from 'build/entities/snippet';
import { SnippetContext } from 'build/adapters/snippetContext';
import { TextParser } from 'build/parsers/text';
import { JSONSerializer } from 'build/serializers/json';
import { Chunk } from 'build/utilities/chunk';
import { Path } from 'build/utilities/path';
import { transformBreadcrumbs } from 'build/transformers';

const watchFiles = (contentDir, templates, { actions, store }) => {
  const { createPage, deletePage } = actions;
  const deletePageIfExists = slug => {
    const page = store.getState().pages.get(slug);
    if (page) deletePage({ path: page.path, component: page.component });
  };
  const watcher = chokidar.watch(`${contentDir}/**/*.md`, {
    ignored: `${contentDir}/**/README.md`,
    persistent: true,
  });
  let isReady = false;

  const updateSnippet = path => {
    const config = Path.findContentConfigFromRawSnippet(path);
    TextParser.fromPath(path, {
      withMetadata: true,
    }).then(data => {
      const snippet = new Snippet(data, config);
      const snippetContext = new SnippetContext(snippet).toObject({
        withVscodeUrl: true,
      });
      const cardTemplate = config.cardTemplate;
      const indexChunk = Chunk.createIndex(
        snippet.slug,
        'SnippetPage',
        (snippet.ranking * 0.85).toFixed(2),
        {
          vscodeUrl: snippet.vscodeUrl,
        }
      );
      JSONSerializer.serializeToDir(
        `${snippet.config.outPath}/${snippet.slug.slice(1)}`,
        ['index', indexChunk],
        ['snippet', { snippet: snippetContext }],
        [
          'metadata',
          {
            cardTemplate,
            // TODO: Create something for breadcrumbs
            breadcrumbs: transformBreadcrumbs(snippet, cardTemplate),
            pageDescription: snippet.seoDescription,
          },
        ]
      );
      createPage({
        path: indexChunk.relRoute,
        component: templates[indexChunk.template],
        context: {
          snippet: snippetContext,
          cardTemplate,
          breadcrumbs: transformBreadcrumbs(snippet, cardTemplate),
          pageDescription: snippet.seoDescription,
        },
      });
    });
  };
  const deleteSnippet = path => {
    const slug = Path.findSlugFromRawSnippet(path);
    fs.removeSync(slug);
    deletePageIfExists(slug);
  };

  watcher
    .on('ready', () => {
      isReady = true;
    })
    .on('add', path => {
      if (isReady) updateSnippet(path);
    })
    .on('change', path => {
      if (isReady) updateSnippet(path);
    })
    .on('unlink', path => {
      if (isReady) deleteSnippet(path);
    });

  return watcher;
};

/**
 * Tell plugins to add pages.
 * Takes a list of requirable objects and a templates object.
 * Creates pages by running createPage for each ne.
 */
const createPagesStatefully = (templates, requirables) => ({
  actions,
  store,
}) => {
  const { createPage } = actions;

  // First pass, create pages for files.
  requirables.forEach(req => {
    let context = { ...req.context };
    if (process.env.NODE_ENV === 'development' && req.context.snippet)
      context.snippet.vscodeUrl = req.vscodeUrl;
    createPage({
      path: req.relRoute,
      component: templates[req.template],
      context,
    });
  });

  const mainListing = requirables.find(req => req.context.isMainListing);
  createPage({
    path: '/',
    component: templates[mainListing.template],
    context: mainListing.context,
  });

  if (process.env.NODE_ENV === 'development') {
    watchFiles(paths.rawContentPath, templates, { actions, store });
    createPage({
      path: '/developer',
      component: templates['DeveloperPage'],
      context: {
        configs: process.configs.map(cfg => ({
          name: cfg.name,
          sourceDir: cfg.sourceDir,
          slugPrefix: cfg.slugPrefix,
        })),
      },
    });
  }
};

export default createPagesStatefully;
