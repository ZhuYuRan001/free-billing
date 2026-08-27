type Props = { eyebrow?: string; title: string; description?: string; action?: React.ReactNode };

export function PageHeader({ eyebrow, title, description, action }: Props) {
  return <header className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}
