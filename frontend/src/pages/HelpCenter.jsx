import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, LifeBuoy } from 'lucide-react';
import api from '../services/api';

export default function HelpCenter() {
  const [topics, setTopics] = useState([]);
  const [selectedTopicIndex, setSelectedTopicIndex] = useState(0);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get('/help-center')
      .then(({ data }) => {
        setTopics((Array.isArray(data) ? data : []).map((topic) => ({
          topic: topic.topic || topic.category || 'General',
          issues: (topic.issues || []).map((issue) => ({
            id: issue.id,
            question: issue.question || issue.title || 'Help issue',
            answer: issue.answer || issue.content || ''
          }))
        })));
        setSelectedTopicIndex(0);
        setSelectedIssue(null);
        setError('');
      })
      .catch(() => {
        setTopics([]);
        setError('Help topics load panna mudiyala.');
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedTopic = topics[selectedTopicIndex] || null;
  const issues = selectedTopic?.issues || [];

  const answer = useMemo(() => {
    if (!selectedIssue?.answer) return '';
    return String(selectedIssue.answer).split(/\n+/).filter(Boolean);
  }, [selectedIssue]);

  function selectTopic(index) {
    setSelectedTopicIndex(index);
    setSelectedIssue(null);
  }

  return (
    <main className="help-page help-flow-page">
      <section className="help-flow-header">
        <div>
          <p className="eyebrow">Help Center</p>
          <h1>How can we help?</h1>
        </div>
        <div className="help-action-row">
          <Link to="/help/raise-ticket">Raise support ticket</Link>
          <Link to="/help/my-tickets">My tickets</Link>
        </div>
      </section>

      {loading && <div className="help-flow-state"><LifeBuoy size={22} /> Loading help center...</div>}
      {error && <div className="help-flow-state error">{error}</div>}

      {!loading && !error && (
        <section className="help-flow-grid">
          <article className="help-flow-column">
            <header>
              <span>Step 1</span>
              <strong>Select Topic</strong>
            </header>
            <div className="help-flow-list">
              {topics.map((topic, index) => (
                <button
                  className={selectedTopicIndex === index ? 'selected' : ''}
                  key={topic.topic}
                  type="button"
                  onClick={() => selectTopic(index)}
                >
                  <span>{topic.topic}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </article>

          <article className="help-flow-column">
            <header>
              <span>Step 2</span>
              <strong>Select Issue</strong>
            </header>
            <div className="help-flow-list">
              {issues.map((issue, index) => (
                <button
                  className={selectedIssue?.id === issue.id ? 'selected' : ''}
                  key={issue.id}
                  type="button"
                  onClick={() => setSelectedIssue(issue)}
                >
                  <span>{issue.question}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
              {!issues.length && <p className="helper-text">No issues in this topic.</p>}
            </div>
          </article>

          <article className="help-flow-column assistance">
            <header>
              <span>Step 3</span>
              <strong>Get Assistance</strong>
            </header>
            {selectedIssue ? (
              <div className="help-flow-answer">
                {answer.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              </div>
            ) : (
              <p className="empty-text">Please select an issue to view assistance.</p>
            )}
          </article>
        </section>
      )}
    </main>
  );
}
