# Logsearch

Logsearch is a lightweight Node.js application that allows users to query log files via an HTTP GET endpoint. The application is optimized for efficiency and scalability by streaming log entries from potentially very large files. It leverages generators, buffer-based file processing, and validations to ensure secure, fast, and reliable log retrieval.

## Table of Contents

- [Overview](#overview)
- [API Endpoint](#api-endpoint)
- [Input Validation](#input-validation)
- [Core File Query Logic](#core-file-query-logic)
  - [Reverse File Traversal](#reverse-file-traversal)
  - [Chunk Processing](#chunk-processing)
  - [Leftover Buffer Handling](#leftover-buffer-handling)
  - [Streaming and Filtering](#streaming-and-filtering)
- [Performance Considerations](#performance-considerations)
- [Error Handling and Security](#error-handling-and-security)
- [Setup](#setup)
- [Summary](#summary)

## Overview

Logsearch allows users to stream log files efficiently by reading files in reverse. This ensures that the most recent entries are retrieved quickly without the need to scan the entire file. The core processing logic is implemented in `blockReader.ts` and integrates thorough input and runtime validations to maintain performance and security.

## API Endpoint

- **Endpoint:** `GET /file`
- **Query Parameters:**
  - **filepath (required):** The file or directory path to query.
  - **entries (optional):** A positive integer specifying the maximum number of log entries to return.
  - **search (optional):** A string used to filter log entries. The search query must not be empty and is limited to a maximum (default up to 10,000 characters).

## Input Validation

1. **Type and Range Checks:**

   - **`filepath`:** Must be provided.
   - **`numentries`:** If provided, must be a positive number.
   - **`search`:** Must not be empty and its length must fall within a configurable range (default: 1 to 10,000 characters).

2. **Runtime Path Validation:**
   - The filepath undergoes additional runtime checks to prevent directory traversal attacks.
   - The file path is resolved relative to a base directory and validated to ensure that users cannot traverse upward in the directory structure.

## Core File Query Logic

Most of the core logic is encapsulated in the `blockReader.ts` file. The following sections describe its main components:

### Reverse File Traversal

- **Reverse Reading:**
  Files are traversed in chunks starting from the end, ensuring that log entries are naturally pre-sorted in chronological order. This optimizes performance for queries that require only a subset of the most recent entries.

### Chunk Processing

- **Chunk-Based Reads:**
  The file is read in configurable chunks (default: 1MB). For each chunk, the application:

  - Searches for a newline character.
  - If a newline is found, splits the chunk into segments:
    - **Before the newline:** Becomes the new leftover buffer.
    - **After the newline:** Combined with any existing leftover to form complete log lines.
  - These complete log lines are then filtered (if a search query is provided) and streamed to the client.

- **Buffer-Level Operations:**
  Direct operations on buffers (without converting to strings immediately) reduce memory copying overhead and yield performance gains.

### Leftover Buffer Handling

- **Accumulating Leftover Data:**
  If a chunk does not contain a newline, its data is prepended to the existing leftover buffer.

- **Maximum Buffer Size:**
  A maximum size for the leftover buffer is enforced (default: 10MB). If the buffer exceeds this limit:

  - The application scans backward in the file (in chunks) to locate the start of the current line.
  - Once the start and end positions of the current line are determined, the line is processed in buffered chunks.
  - If a search query is providedthe current line is examined to decide if it should be streamed to the client.

- **Overlapping Buffer for Search:**
  When processing for the search parameter, overlapping buffers (equal to the search term's length) are maintained to ensure no potential match is missed across chunk boundaries.

### Streaming and Filtering

- **Asynchronous Generators and Streaming:**
  An asynchronous generator (`generateLines`) yields complete log lines, which are then streamed to the client using Node.js streams (via `Readable.from()`).

- **Search Filtering:**
  If a search query is specified, only log lines that include the search term are processed and sent to the client. A major edge case is the scenario where the leftover buffer grows excessively. To address this, a maximum buffer size (default is 10MB) is enforced. Once this limit is reached, the system determines the end of the current line by adding the current position to the leftover size, and then it traverses backward in chunks until it locates the start of the line. With the file offsets for the beginning and end of the line identified, the line is processed in buffered chunks. If a search query is present, each buffered chunk is checked for the search term. To ensure no match is missed between chunks, a buffer sized to the length of the search term is retained as an overlap. Once the entire line has been processed, if the search term is found, the line is streamed to the client using the established start and end offsets.

- **Binary Data Detection:**
  Each decoded chunk is validated for unsupported or binary data by checking for indicators such as the Unicode replacement character (`\ufffd`) and additional heuristics like control character ratios.

- **File Change Monitoring:**
  Before processing each new block, the application verifies via `fs.stat` that the file has not been modified during reading. If a modification is detected, processing is aborted to prevent inconsistencies.

## Performance Considerations

- **Memory Efficiency:**
  By processing the file in fixed-size chunks and using asynchronous generators, Logsearch avoids loading entire files into memory. Buffer-level operations further reduce unnecessary memory overhead.

- **Optimized Reverse Traversal:**
  Reading the file in reverse ensures that the application quickly accesses recent log entries without scanning the entire file.

## Error Handling and Security

- **Graceful Error Handling:**
  The application handles errors (such as file modifications during reading or detection of unsupported data) gracefully by aborting processing and returning an appropriate error message to the client.

- **Security Measures:**
  - Validation of input parameters.
  - Runtime path resolution to prevent directory traversal attacks.
  - Aborting operations if file integrity is compromised during a read.

## Setup

### Server Setup

1. **Navigate to the Server Directory:**
   ```bash
     cd server
    npm install
   ```
   **Tests**

- ## Test Setup

1. **Navigate to the Server Directory (if you aren’t there already):**
   ```bash
   cd server
   npm run test
   ```

**Client**

- ## Client Setup

1. **Navigate to the Server Directory (if you aren’t there already):**
   ```bash
   cd client
   npm run start
   ```
