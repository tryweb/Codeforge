## ADDED Requirements

### Requirement: Collapsible mobile navigation

At viewports of 768px width or narrower, the admin UI SHALL hide the sidebar by default and display a top bar containing a hamburger toggle. Tapping the toggle SHALL reveal the sidebar as an overlay above the page content together with a backdrop; tapping the backdrop SHALL dismiss the sidebar. At viewports wider than 768px, the existing fixed sidebar layout SHALL render unchanged.

#### Scenario: Sidebar hidden by default on mobile

- **WHEN** any admin page loads at a viewport of 768px width or narrower
- **THEN** the sidebar is not visible, and a top bar with a hamburger toggle is displayed above the page content

#### Scenario: Open navigation via hamburger toggle

- **WHEN** the user taps the hamburger toggle on a narrow viewport
- **THEN** the sidebar slides in as an overlay and a backdrop covers the main content

#### Scenario: Dismiss navigation via backdrop

- **WHEN** the sidebar overlay is open and the user taps the backdrop
- **THEN** the sidebar is hidden and the backdrop is removed

#### Scenario: Navigation closes after following a link

- **WHEN** the user taps a navigation link inside the open sidebar overlay
- **THEN** the browser navigates to the target page and the sidebar is closed on the loaded page

#### Scenario: Desktop layout unaffected

- **WHEN** any admin page loads at a viewport wider than 768px
- **THEN** the fixed sidebar renders exactly as before and the top bar with hamburger toggle is not displayed

### Requirement: Minimum touch target sizing

At viewports of 768px width or narrower, interactive elements — including buttons, outline buttons, navigation links, and in-table action buttons — SHALL have an effective height of at least 44px.

#### Scenario: Primary controls meet touch target size

- **WHEN** any admin page is viewed at a viewport of 768px width or narrower
- **THEN** all buttons and navigation links have an effective height of at least 44px

#### Scenario: Small inline-styled action buttons enlarged

- **WHEN** a page containing small action buttons (e.g., projects table "Enable" buttons, dashboard restart buttons) is viewed at a viewport of 768px width or narrower
- **THEN** those buttons are enlarged to at least 44px effective height despite their inline styles

### Requirement: Horizontally scrollable tables

At viewports of 768px width or narrower, tables that exceed the available width SHALL be horizontally scrollable within their container, and SHALL NOT stretch the page beyond the viewport width.

#### Scenario: Wide table scrolls within its card

- **WHEN** a page with a multi-column table (e.g., the projects overview table) is viewed at a viewport narrower than the table's natural width
- **THEN** the table scrolls horizontally inside its container while the page itself does not scroll horizontally

### Requirement: Viewport-fitting modals

At viewports of 768px width or narrower, modal dialogs SHALL fit within the viewport width with a safe margin on both sides.

#### Scenario: Create-project modal fits phone screen

- **WHEN** the create-project modal is opened at a viewport of 375px width
- **THEN** the modal is fully visible within the viewport with margins on both sides, and all form fields and action buttons are reachable without horizontal scrolling
