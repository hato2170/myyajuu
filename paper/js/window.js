if (window.parent && typeof window.parent.maeExportApis_ === 'function') {
  try {
    window.parent.maeExportApis_();
  } catch (e) {}
}
