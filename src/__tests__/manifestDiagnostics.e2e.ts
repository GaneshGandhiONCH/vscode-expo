import fs from 'fs';
import path from 'path';
import { DiagnosticSeverity, languages, TextEditor, window } from 'vscode';

import { ManifestDiagnosticsProvider } from '../manifestDiagnostics';
import { findContentRange, getWorkspaceUri, storeOriginalContent } from './utils/vscode';
import { waitFor } from './utils/wait';

describe(ManifestDiagnosticsProvider, () => {
  // Based on: https://github.com/microsoft/vscode-extension-samples/blob/fdd3bb95ce8e38ffe58fc9158797239fdf5017f1/lsp-sample/client/src/test/diagnostics.test.ts#L31

  let app: TextEditor;
  let restoreContent: ReturnType<typeof storeOriginalContent>;

  beforeAll(async () => {
    app = await window.showTextDocument(getWorkspaceUri('manifest-diagnostics/app.json'));
    restoreContent = storeOriginalContent(app);
  });

  afterEach(async () => {
    await restoreContent();
  });

  it('diagnoses non-existing asset file reference', async () => {
    const range = findContentRange(app, './assets/splash.png');
    await app.edit((builder) => builder.replace(range, './assets/doesnt-exist.png'));
    await app.document.save();

    await waitFor();
    const diagnostics = await languages.getDiagnostics(app.document.uri);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'FILE_NOT_FOUND',
      message: 'File not found: ./assets/doesnt-exist.png',
      severity: DiagnosticSeverity.Warning,
    });
  });

  it('diagnoses asset directory reference', async () => {
    const range = findContentRange(app, './assets/adaptive-icon.png');
    await app.edit((builder) => builder.replace(range, './assets'));
    await app.document.save();

    await waitFor();
    const diagnostics = await languages.getDiagnostics(app.document.uri);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'FILE_IS_DIRECTORY',
      message: 'File is a directory: ./assets',
      severity: DiagnosticSeverity.Warning,
    });
  });

  it('diagnoses non-existing plugin definition', async () => {
    const range = findContentRange(app, '"plugins": ["expo-system-ui"]');
    await app.edit((builder) => builder.replace(range, '"plugins": ["doesnt-exists"]'));
    await app.document.save();

    await waitFor();
    const diagnostics = await languages.getDiagnostics(app.document.uri);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'PLUGIN_NOT_FOUND',
      message: 'Plugin not found: doesnt-exists',
      severity: DiagnosticSeverity.Warning,
    });
  });

  it('diagnoses empty string plugin definition', async () => {
    const range = findContentRange(app, '"plugins": ["expo-system-ui"]');
    await app.edit((builder) => builder.replace(range, `"plugins": ["expo-system-ui", ""]`));
    await app.document.save();

    await waitFor();
    const diagnostics = await languages.getDiagnostics(app.document.uri);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: `PLUGIN_DEFINITION_INVALID`,
      message: 'Plugin definition is empty, expected a file or dependency name',
      severity: DiagnosticSeverity.Warning,
    });
  });

  it('diagnoses empty array plugin definition', async () => {
    const range = findContentRange(app, '"plugins": ["expo-system-ui"]');
    await app.edit((builder) => builder.replace(range, `"plugins": ["expo-system-ui", []]`));
    await app.document.save();

    await waitFor();
    const diagnostics = await languages.getDiagnostics(app.document.uri);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: `PLUGIN_DEFINITION_INVALID`,
      message: 'Plugin definition is empty, expected a file or dependency name',
      severity: DiagnosticSeverity.Warning,
    });
  });

  it('re-diagnoses newly installed plugins', async () => {
    const pluginFile = getWorkspaceUri('manifest-diagnostics/.expo/new-plugin.js').fsPath;

    // Force-remove the new plugin, to ensure it's not installed
    // Also use a gitignored folder to make sure its never committed
    fs.rmSync(pluginFile, { force: true });

    const preRange = findContentRange(app, '"plugins": ["expo-system-ui"]');
    await app.edit((builder) => builder.replace(preRange, '"plugins": ["./.expo/new-plugin.js"]'));
    await app.document.save();

    await waitFor();
    const preInstallDiagnostic = await languages.getDiagnostics(app.document.uri);

    expect(preInstallDiagnostic).toHaveLength(1);
    expect(preInstallDiagnostic[0]).toMatchObject({
      code: 'PLUGIN_NOT_FOUND',
      message: 'Plugin not found: ./.expo/new-plugin.js',
      severity: DiagnosticSeverity.Warning,
    });

    // Create the new plugin file
    fs.mkdirSync(path.dirname(pluginFile), { recursive: true });
    fs.writeFileSync(
      pluginFile,
      'module.exports = function noopPlugin(config) { return config; };'
    );

    // Force an update in the manifest file, reset the existing diagnostics
    await app.edit((builder) =>
      builder.replace(
        findContentRange(app, '"plugins": ["./.expo/new-plugin.js"]'),
        '"plugins": ["./.expo/new-plugin.js" ]'
      )
    );
    await app.document.save();

    await waitFor();
    const postInstallDiagnostic = await languages.getDiagnostics(app.document.uri);
    expect(postInstallDiagnostic).toHaveLength(0);

    fs.rmSync(pluginFile, { force: true });
  });

  // Note, we don't test for plugin definitions with more than 2 array items.
  // That's handled by JSON Schema and out of scope for this test.
});
