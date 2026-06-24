import '@testing-library/jest-dom';

// JSDOM doesn't implement scrollIntoView by default, so we mock it for React testing.
window.HTMLElement.prototype.scrollIntoView = function() {};
