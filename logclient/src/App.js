import React, { useState } from 'react';
import './App.css';

function App() {
  const [filepath, setFilepath] = useState('');
  const [search, setSearch] = useState('');
  const [numEntries, setNumEntries] = useState('');
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setLog('');

    const params = new URLSearchParams();
    params.append('filepath', filepath);
    if (search) params.append('search', search);
    if (numEntries) params.append('entries', numEntries);

    try {
      const response = await fetch(
        `http://localhost:3001/file?${params.toString()}`
      );
      if (!response.ok) {
        const errMsg = await response.text();
        setError(errMsg);
        setLoading(false);
        return;
      }
      // Stream the response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulated = '';

      // Read the streamed response chunk by chunk
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          accumulated += decoder.decode(value, { stream: !done });
          setLog(accumulated);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <h1>Log Viewer</h1>
      <form onSubmit={handleSubmit} className="log-form">
        <div className="form-group">
          <label htmlFor="filepath">File or Directory:</label>
          <input
            type="text"
            id="filepath"
            value={filepath}
            onChange={(e) => setFilepath(e.target.value)}
            placeholder="Enter file or directory path"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="search">Search Query (optional):</label>
          <input
            type="text"
            id="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Enter search query"
          />
        </div>
        <div className="form-group">
          <label htmlFor="numEntries">Number of Entries (optional):</label>
          <input
            type="number"
            id="numEntries"
            value={numEntries}
            onChange={(e) => setNumEntries(e.target.value)}
            placeholder="Enter number of entries"
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Loading...' : 'Fetch Log'}
        </button>
      </form>
      {loading && (
        <div className="spinner-container">
          <div className="spinner" />
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="log-container">
        <pre>{log}</pre>
      </div>
    </div>
  );
}

export default App;
