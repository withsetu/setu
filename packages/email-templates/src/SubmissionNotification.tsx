import { Html, Head, Body, Container, Heading, Text, Section, Row, Column } from '@react-email/components'
import type { Submission } from '@setu/core'

export function SubmissionNotification({ submission }: { submission: Submission }) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, sans-serif', background: '#f4f4f5' }}>
        <Container style={{ background: '#fff', padding: '24px', borderRadius: '8px' }}>
          <Heading as="h2">New submission: {submission.formLabel ?? submission.formId}</Heading>
          <Section>
            {Object.entries(submission.fields).map(([k, v]) => (
              <Row key={k}>
                <Column style={{ width: '120px', color: '#71717a', verticalAlign: 'top' }}>
                  <Text style={{ margin: '4px 0' }}>{k}</Text>
                </Column>
                <Column>
                  <Text style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{v}</Text>
                </Column>
              </Row>
            ))}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}
